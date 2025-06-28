using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Azure;
using Microsoft.Extensions.Hosting;
using OpenAI.Moderations;
using OpenAI.Responses;
using System.ClientModel;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace OrgAI;

public static class Api
{
  public const string FlagToken = "[FLAG]";
  public const string FlagIcon = "\uD83D\uDEA9";
  private const string MessageDelimeter = "\n\n---\n\n";

  public static void MapApiPaths(this WebApplication app)
  {
    var group = app.MapGroup("/api").ValidateAntiforgery();

    group.MapPost("/chat", [Authorize] async ([FromForm] string id, [FromForm] string presetId, [FromForm] string prompt, [FromForm] IFormFileCollection files,
      [FromForm] string instanceId, HttpContext context, IHubContext<ChatHub, IChatClient> hubContext) =>
    {
      var userEmail = context.User.Identity.Name;
      var userGroupName = UserGroup.GroupNameByUserEmail[userEmail];
      var userGroup = UserGroup.ConfigByGroupName[userGroupName];
      var isReviewer = userGroup.Reviewers.Contains(userEmail);
      var isFirstTurn = string.IsNullOrEmpty(id);

      if (string.IsNullOrEmpty(instanceId)) return Results.BadRequest("Instance ID cannot be empty.");
      if (string.IsNullOrEmpty(prompt)) return Results.BadRequest("Prompt cannot be empty.");
      if (files is not null && files.Count > 3) return Results.BadRequest("Too many files.");
      if (files is not null && files.Any(file => file.Length > 10 * 1024 * 1024)) return Results.BadRequest("File size exceeds 10 MB.");
      if ((files?.Count ?? 0) > 0 && !userGroup.AllowUploads) return Results.BadRequest("File uploads are not allowed.");

      var spend = await TableService.GetSpendAsync(userEmail);
      if (spend >= userGroup.UserMaxWeeklySpend) return Results.StatusCode(429);

      Task<SummaryResponse> summaryTask = null;
      Conversation conversation = null;
      ConversationEntity conversationEntity = null;

      var moderationClient = new ModerationClient("omni-moderation-latest", userGroup.ApiKey);
      float moderationScore;

      if (isFirstTurn)
      {
        if (string.IsNullOrEmpty(presetId) || !userGroup.PresetDictionary.TryGetValue(presetId, out var preset))
        {
          return Results.BadRequest("Invalid preset name.");
        }
        if (preset.Instructions.Contains("[RANDOM_10_ABCD]", StringComparison.OrdinalIgnoreCase))
        {
          preset = JsonSerializer.Deserialize<Preset>(JsonSerializer.Serialize(preset));
          var randomString = string.Join(", ", Enumerable.Range(0, 10).Select(_ => new[] { 'a', 'b', 'c', 'd' }[Random.Shared.Next(4)]));
          preset.Instructions = preset.Instructions.Replace("[RANDOM_10_ABCD]", randomString, StringComparison.OrdinalIgnoreCase);
        }

        conversation = new Conversation { Preset = preset };

        id = Guid.NewGuid().ToString();

        var moderationPrompt = string.IsNullOrEmpty(preset.Title) ? prompt : $"{preset.Title}:{MessageDelimeter}{prompt}";
        var moderationResult = await moderationClient.ClassifyTextAsync(moderationPrompt);
        moderationScore = moderationResult.Value.GetScore();

        if (moderationScore >= userGroup.ModerationThreshold)
        {
          conversationEntity = new ConversationEntity(userEmail, id, $"{FlagIcon} Content flagged", 0m);
          await TableService.UpsertConversationAsync(conversationEntity);
        }
        else
        {
          summaryTask = SummariseAsync(preset.Title, prompt, id, userGroup.ApiKey);
        }
      }
      else
      {
        var tableTask = TableService.GetConversationAsync(userEmail, id);
        var blobTask = BlobService.GetConversationAsync(id);
        await Task.WhenAll(tableTask, blobTask);
        conversationEntity = await tableTask;
        conversation = await blobTask;
        if (conversationEntity.IsDeleted)
        {
          return Results.NotFound("Conversation not found.");
        }
        if (conversation.Turns.Any(o => o.Role == "assistant" && o.Text == FlagToken))
        {
          return Results.BadRequest("Cannot continue a conversation that has been flagged.");
        }
        var pastConversation = string.Join(MessageDelimeter, conversation.Turns.Where(o => o.Role == "user").Select(turn => turn.Text));
        var moderationTitle = string.IsNullOrEmpty(conversation.Preset.Title) ? string.Empty : $"{conversation.Preset.Title}:{MessageDelimeter}";
        var moderationResult = await moderationClient.ClassifyTextAsync(moderationTitle + pastConversation + MessageDelimeter + prompt);
        moderationScore = moderationResult.Value.GetScore();
        if (moderationScore >= userGroup.ModerationThreshold)
        {
          conversationEntity.Title = $"{FlagIcon} {conversationEntity.Title}";
          await TableService.UpsertConversationAsync(conversationEntity);
        }
      }

      if (!OpenAIConfig.Instance.ModelDictionary.TryGetValue(conversation.Preset.Model, out var model))
      {
        return Results.BadRequest("Model not supported.");
      }

      var userTurn = new ConversationTurn
      {
        Role = "user",
        Text = prompt,
        Timestamp = DateTime.UtcNow
      };
      if (files is not null)
      {
        foreach (var file in files)
        {
          using var stream = new MemoryStream();
          await file.CopyToAsync(stream);
          var base64Content = Convert.ToBase64String(stream.ToArray());
          if (file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
          {
            userTurn.Images ??= [];
            userTurn.Images.Add(new ConversationTurnImage { Content = base64Content, Type = file.ContentType });
          }
          else
          {
            userTurn.Files ??= [];
            userTurn.Files.Add(new ConversationTurnFile { Content = base64Content, Filename = file.FileName });
          }
        }
      }
      conversation.Turns.Add(userTurn);
      var spendLimitReached = false;

      if (moderationScore >= userGroup.ModerationThreshold)
      {
        conversation.Turns.Add(new() { Role = "assistant", Text = FlagToken });
        var updateBlobTask = BlobService.CreateOrUpdateConversationAsync(id, conversation);
        var reviewTask = isReviewer ? Task.CompletedTask : TableService.UpsertReviewEntityAsync(conversationEntity, userGroupName);
        await Task.WhenAll(updateBlobTask, reviewTask);
      }
      else
      {
        var hasTemp = conversation.Preset.Temperature is not null;
        var chatClient = new OpenAIResponseClient(model.Name, userGroup.ApiKey);
        var chatOptions = new ResponseCreationOptions
        {
          EndUserId = id,
          Instructions = conversation.Preset.Instructions,
          Temperature = hasTemp ? Convert.ToSingle(conversation.Preset.Temperature, CultureInfo.InvariantCulture) : null,
          TopP = (hasTemp && conversation.Preset.Temperature < 0.4m) ? 0.9f : null,
          ReasoningOptions = conversation.Preset.ReasoningEffort switch
          {
            "low" => new() { ReasoningEffortLevel = ResponseReasoningEffortLevel.Low },
            "medium" => new() { ReasoningEffortLevel = ResponseReasoningEffortLevel.Medium },
            "high" => new() { ReasoningEffortLevel = ResponseReasoningEffortLevel.High },
            _ => null
          },
          StoredOutputEnabled = false
        };
        if (conversation.Preset.WebSearchEnabled && model.CostPer1KWebSearches is not null)
        {
          var org = Organisation.Instance;
          var location = WebSearchToolLocation.CreateApproximateLocation(org.CountryCode, org.City, org.City, org.Timezone);
          chatOptions.Tools.Add(ResponseTool.CreateWebSearchTool(location));
        }
        if (conversation.Preset.VectorStoreId is not null)
        {
          chatOptions.Tools.Add(ResponseTool.CreateFileSearchTool([conversation.Preset.VectorStoreId], 10));
        }

        var streamer = hubContext.Clients.User(userEmail);
        var responseItems = conversation.AsResponseItems();
        var responseStream = chatClient.CreateResponseStreamingAsync(responseItems, chatOptions);

        await foreach (var update in responseStream)
        {
          switch (update)
          {
            case StreamingResponseOutputTextDeltaUpdate text:
              await streamer.Append(text.Delta, instanceId);
              break;
            case StreamingResponseWebSearchCallInProgressUpdate:
              await streamer.Append("[web_search_in_progress]", instanceId);
              break;
            case StreamingResponseWebSearchCallCompletedUpdate:
              await streamer.Append("[web_search_completed]", instanceId);
              break;
            case StreamingResponseFileSearchCallSearchingUpdate:
              await streamer.Append("[file_search_in_progress]", instanceId);
              break;
            case StreamingResponseFileSearchCallCompletedUpdate:
              await streamer.Append("[file_search_completed]", instanceId);
              break;
            case StreamingResponseCompletedUpdate completion:
              conversation.Turns.Add(new() { Role = "assistant", Text = completion.Response.GetOutputText() });
              var cost = CalculateCost(model, completion.Response.Usage, completion.Response.OutputItems.Count(item => item is WebSearchCallResponseItem),
                completion.Response.OutputItems.Count(item => item is FileSearchCallResponseItem));
              if (isFirstTurn)
              {
                var summaryResponse = await summaryTask;
                cost += CalculateCost(OpenAIConfig.Instance.ModelDictionary[OpenAIConfig.Instance.TitleSummarisationModel], summaryResponse.Usage);
                conversationEntity = new ConversationEntity(userEmail, id, summaryResponse.Title, cost);
              }
              else
              {
                var existingCost = decimal.Parse(conversationEntity.Cost.ToString(), CultureInfo.InvariantCulture);
                conversationEntity.Cost = (existingCost + cost).ToString(CultureInfo.InvariantCulture);
              }
              var updateBlobTask = BlobService.CreateOrUpdateConversationAsync(id, conversation);
              var recordSpendTask = TableService.RecordSpendAsync(userEmail, cost, userGroupName);
              var updateEntityTask = TableService.UpsertConversationAsync(conversationEntity);
              var reviewTask = moderationScore >= userGroup.ReviewThreshold && !isReviewer
                ? TableService.UpsertReviewEntityAsync(conversationEntity, userGroupName)
                : Task.CompletedTask;
              await Task.WhenAll(recordSpendTask, updateBlobTask, updateEntityTask, reviewTask);
              spendLimitReached = (await recordSpendTask) >= userGroup.UserMaxWeeklySpend;
              break;
            default:
              break;
          }
        }
      }

      return Results.Ok(new ChatResponse
      {
        Id = isFirstTurn ? id : null,
        Title = isFirstTurn ? conversationEntity.Title : null,
        SpendLimitReached = spendLimitReached,
        Content = conversation.Turns[^1]
      });
    });

    group.MapGet("/conversations/{id}", [Authorize] async (string id, HttpContext context) =>
    {
      var userEmail = context.User.Identity.Name;
      var tableTask = TableService.ConversationExistsAsync(userEmail, id);
      var blobTask = BlobService.GetConversationAsync(id);
      var entityExists = await tableTask;
      if (!entityExists) return Results.NotFound();
      var conversation = await blobTask;
      return Results.Ok(conversation);
    });

    group.MapGet("/conversations/{group}/{id}", [Authorize] async (string group, string id, HttpContext context) =>
    {
      var userEmail = context.User.Identity.Name;
      if (!UserGroup.ConfigByGroupName.TryGetValue(group, out var groupConfig)) return Results.Forbid();
      if (!groupConfig.Reviewers.Contains(userEmail)) return Results.Forbid();
      var tableTask = TableService.ReviewExistsAsync(group, id);
      var blobTask = BlobService.GetConversationAsync(id);
      var entityExists = await tableTask;
      if (!entityExists) return Results.NotFound();
      var conversation = await blobTask;
      return Results.Ok(conversation);
    });

    group.MapDelete("/conversations/{id}", [Authorize] async (string id, HttpContext context) =>
    {
      var userEmail = context.User.Identity.Name;
      var userGroupName = UserGroup.GroupNameByUserEmail[userEmail];
      var userGroup = UserGroup.ConfigByGroupName[userGroupName];
      var isReviewer = userGroup.Reviewers.Contains(userEmail);
      if (isReviewer)
      {
        await TableService.DeleteConversationAsync(userEmail, id);
        await BlobService.DeleteConversationAsync(id);
      }
      else
      {
        var conversationEntity = await TableService.GetConversationAsync(userEmail, id);
        if (conversationEntity.IsDeleted) return Results.NotFound("Conversation not found.");
        conversationEntity.IsDeleted = true;
        await TableService.UpsertConversationAsync(conversationEntity);
      }
      return Results.NoContent();
    });

    group.MapPost("/conversations/{group}/{id}/resolve", [Authorize] async (string group, string id, HttpContext context) =>
    {
      var userEmail = context.User.Identity.Name;
      if (!UserGroup.ConfigByGroupName.TryGetValue(group, out var groupConfig)) return Results.Forbid();
      if (!groupConfig.Reviewers.Contains(userEmail)) return Results.Forbid();
      await TableService.DeleteReviewEntityAsync(group, id);
      return Results.NoContent();
    });

    group.MapGet("/refresh", [Authorize] async (HttpContext context) =>
    {
      if (!UserGroup.GroupNamesByReviewerEmail.Contains(context.User.Identity.Name)) return Results.Forbid();
      await BlobService.LoadConfigAsync();
      return Results.Content("Refreshed presets.", "text/plain");
    });

    group.MapGet("/token", [Authorize] async ([FromQuery] string presetId, HttpContext context, IHttpClientFactory httpClientFactory) =>
    {
      var userEmail = context.User.Identity.Name;
      var userGroup = UserGroup.ConfigByGroupName[UserGroup.GroupNameByUserEmail[userEmail]];

      var spend = await TableService.GetSpendAsync(userEmail);
      if (spend >= userGroup.UserMaxWeeklySpend) return Results.StatusCode(429);

      if (string.IsNullOrEmpty(presetId) || !userGroup.PresetDictionary.TryGetValue(presetId, out var preset))
      {
        return Results.BadRequest("Invalid preset name.");
      }

      var client = httpClientFactory.CreateClient("OpenAI");
      client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", userGroup.ApiKey);
      var request = new RealtimeSessionRequest
      {
        Model = preset.Model,
        Voice = preset.Voice,
        Instructions = preset.Instructions
      };
      var response = await client.PostAsJsonAsync("/v1/realtime/sessions", request);
      var json = await response.Content.ReadAsStringAsync();
      return Results.Content(json, "application/json");
    });

    group.MapPost("/record", [Authorize] async ([FromBody] RealtimeConversationEntry entry, HttpContext context) =>
    {
      var userEmail = context.User.Identity.Name;
      var userGroupName = UserGroup.GroupNameByUserEmail[userEmail];
      var userGroup = UserGroup.ConfigByGroupName[userGroupName];
      var isReviewer = userGroup.Reviewers.Contains(userEmail);
      var isFirstTurn = string.IsNullOrEmpty(entry.CurrentChatId);

      if (entry is null) return Results.BadRequest("Entry cannot be null.");

      var moderationClient = new ModerationClient("omni-moderation-latest", userGroup.ApiKey);
      var moderationResult = await moderationClient.ClassifyTextAsync($"# User\n\n{entry.UserTranscript}\n\n# Assistant\n\n{entry.AssistantTranscript}");
      var moderationScore = moderationResult.Value.GetScore();

      string id = null;
      string title = null;
      decimal cost;
      ConversationEntity conversationEntity = null;
      Conversation conversation = null;
      if (isFirstTurn)
      {
        id = Guid.NewGuid().ToString();
        if (string.IsNullOrEmpty(entry.PresetId) || !userGroup.PresetDictionary.TryGetValue(entry.PresetId, out var preset))
        {
          return Results.BadRequest("Invalid preset name.");
        }
        if (!OpenAIConfig.Instance.ModelDictionary.TryGetValue(preset.Model, out var model))
        {
          return Results.BadRequest("Model not supported.");
        }
        cost = CalculateSpeechCost(model, entry);

        if (moderationScore >= userGroup.ModerationThreshold)
        {
          title = $"{FlagIcon} Content flagged";
        }
        else
        {
          var summaryResponse = await SummariseAsync(null, entry.UserTranscript, id, userGroup.ApiKey);
          cost += CalculateCost(OpenAIConfig.Instance.ModelDictionary[OpenAIConfig.Instance.TitleSummarisationModel], summaryResponse.Usage);
          title = summaryResponse.Title;
        }
        conversationEntity = new ConversationEntity(userEmail, id, title, cost);
        await TableService.UpsertConversationAsync(conversationEntity);
        conversation = new Conversation { Preset = preset };
      }
      else
      {
        id = entry.CurrentChatId;
        conversationEntity = await TableService.GetConversationAsync(userEmail, id);
        conversation = await BlobService.GetConversationAsync(id);
        if (!OpenAIConfig.Instance.ModelDictionary.TryGetValue(conversation.Preset.Model, out var model))
        {
          return Results.BadRequest("Model not supported.");
        }
        cost = CalculateSpeechCost(model, entry);
        var existingCost = decimal.Parse(conversationEntity.Cost.ToString(), CultureInfo.InvariantCulture);
        conversationEntity.Cost = (existingCost + cost).ToString(CultureInfo.InvariantCulture);
        if (moderationScore >= userGroup.ModerationThreshold)
        {
          conversationEntity.Title = $"{FlagIcon} {conversationEntity.Title}";
        }
        await TableService.UpsertConversationAsync(conversationEntity);
      }

      conversation.Turns.Add(new ConversationTurn { Role = "user", Text = entry.UserTranscript, Timestamp = DateTime.UtcNow });
      conversation.Turns.Add(new ConversationTurn { Role = "assistant", Text = entry.AssistantTranscript, Timestamp = DateTime.UtcNow });
      if (moderationScore >= userGroup.ModerationThreshold)
      {
        conversation.Turns.Add(new ConversationTurn { Role = "assistant", Text = FlagToken });
      }
      await BlobService.CreateOrUpdateConversationAsync(id, conversation);
      var spend = await TableService.RecordSpendAsync(userEmail, cost, userGroupName);

      return Results.Ok(new ChatResponse
      {
        Id = isFirstTurn ? id : null,
        Title = isFirstTurn ? title : null,
        SpendLimitReached = spend >= userGroup.UserMaxWeeklySpend,
        Content = conversation.Turns[^1]
      });
    });

    app.MapPut("/api/users", [AllowAnonymous] async (HttpContext context) =>
    {
      if (string.IsNullOrEmpty(Organisation.Instance.SyncApiKey)) return Results.Conflict("A sync API key is not configured.");
      if (!context.Request.Headers.TryGetValue("X-Api-Key", out var apiKey) || apiKey != Organisation.Instance.SyncApiKey) return Results.Unauthorized();
      if (!context.Request.ContentType.StartsWith("text/csv", StringComparison.OrdinalIgnoreCase)) return Results.BadRequest("Content type must be text/csv.");
      using var reader = new StreamReader(context.Request.Body);
      var csvData = await reader.ReadToEndAsync();
      if (string.IsNullOrWhiteSpace(csvData)) return Results.BadRequest("CSV data cannot be empty.");
      await BlobService.UpdateUsersAsync(csvData);
      await BlobService.LoadConfigAsync();
      return Results.NoContent();
    });
  }

  private static float GetScore(this ModerationResult moderationResult)
  {
    return typeof(ModerationResult).GetProperties().Select(p => p.GetValue(moderationResult)).OfType<ModerationCategory>().Max(cat => cat.Flagged ? cat.Score : 0);
  }

  private static async Task<SummaryResponse> SummariseAsync(string presetTitle, string prompt, string id, string apiKey)
  {
    var summaryClient = new OpenAIResponseClient(OpenAIConfig.Instance.TitleSummarisationModel, apiKey);
    var summaryOptions = new ResponseCreationOptions
    {
      EndUserId = id,
      Instructions = "The user will post a prompt. Do NOT respond to the prompt.\n\n" +
        "**Summarise it as succinctly as possible, in 3 words or less, for use as a conversation title.**\n\n" +
        "The first word MUST start with a capital letter, and then use sentence case. Do not use punctuation. Prefer short words. " +
        "Try to capture the full context of the query, not just the task category. " +
        "Only respond with the plaintext title (3 words or less) and nothing else (no introduction or conclusion).",
      Temperature = 0,
      StoredOutputEnabled = false
    };
    var summaryPrompt = string.IsNullOrEmpty(presetTitle) ? prompt : $"{presetTitle}: {prompt}";
    var summaryResponse = await summaryClient.CreateResponseAsync(summaryPrompt, summaryOptions);
    return new SummaryResponse
    {
      Title = string.Join(' ', summaryResponse.Value.GetOutputText().Split(' ', 5, StringSplitOptions.RemoveEmptyEntries).Take(4)).Trim('*'),
      Usage = summaryResponse.Value.Usage
    };
  }

  private static decimal CalculateCost(OpenAIModelConfig model, ResponseTokenUsage usage, int webSearchCount = 0, int fileSearchCount = 0)
  {
#if DEBUG
    return 0;
#else
    return (usage.InputTokenCount * model.CostPer1MInputTokens / 1_000_000m) +
           (usage.OutputTokenCount * model.CostPer1MOutputTokens / 1_000_000m) +
           (webSearchCount * (model.CostPer1KWebSearches ?? 0) / 1000m) +
           (fileSearchCount * OpenAIConfig.Instance.CostPer1KFileSearches / 1000m);
#endif
  }

  private static decimal CalculateSpeechCost(OpenAIModelConfig model, RealtimeConversationEntry entry)
  {
#if DEBUG
    return 0;
#else
    return (entry.InputTextTokens * model.CostPer1MInputTokens / 1_000_000m) +
           (entry.InputAudioTokens * (model.CostPer1MAudioInputTokens ?? 0) / 1_000_000m) +
           (entry.OutputTextTokens * model.CostPer1MOutputTokens / 1_000_000m) +
           (entry.OutputAudioTokens * (model.CostPer1MAudioOutputTokens ?? 0) / 1_000_000m) +
           (entry.CachedInputTextTokens * model.CostPer1MCachedInputTokens / 1_000_000m) +
           (entry.CachedInputAudioTokens * model.CostPer1MCachedInputTokens / 1_000_000m);
#endif
  }
}

public class ChatResponse
{
  [JsonPropertyName("id"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public string Id { get; set; }
  [JsonPropertyName("title"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public string Title { get; set; }
  [JsonPropertyName("spendLimitReached")]
  public bool SpendLimitReached { get; set; }
  [JsonPropertyName("content")]
  public ConversationTurn Content { get; set; }
}

public class SummaryResponse
{
  public string Title { get; set; }
  public ResponseTokenUsage Usage { get; set; }
}