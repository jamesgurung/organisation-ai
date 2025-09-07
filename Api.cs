using Azure;
using Azure.AI.OpenAI;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OpenAI.Responses;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace OrgAI;

#pragma warning disable OPENAI001

public static class Api
{
  public const string FlagToken = "[FLAG]";
  public const string FlagIcon = "\uD83D\uDEA9";

  private static AzureOpenAIClient _azureClient;

  public static void Configure()
  {
    _azureClient = new AzureOpenAIClient(new Uri(OpenAIConfig.Instance.AIFoundryEndpoint), new AzureKeyCredential(OpenAIConfig.Instance.AIFoundryApiKey));
  }

  public static void MapApiPaths(this WebApplication app)
  {
    var group = app.MapGroup("/api").ValidateAntiforgery();

    group.MapPost("/chat", [Authorize] async ([FromForm] string id, [FromForm] string presetId, [FromForm] string prompt, [FromForm] IFormFileCollection files, HttpContext context) =>
    {
      var userEmail = context.User.Identity.Name;
      var userGroupName = UserGroup.GroupNameByUserEmail[userEmail];
      var userGroup = UserGroup.ConfigByGroupName[userGroupName];
      var isReviewer = userGroup.Reviewers.Contains(userEmail);
      var isFirstTurn = string.IsNullOrEmpty(id);

      if (string.IsNullOrEmpty(prompt)) return Results.BadRequest("Prompt cannot be empty.");
      if (files is not null && files.Count > 3) return Results.BadRequest("Too many files.");
      if (files is not null && files.Any(file => file.Length > 10 * 1024 * 1024)) return Results.BadRequest("File size exceeds 10 MB.");
      if ((files?.Count ?? 0) > 0 && !userGroup.AllowUploads) return Results.BadRequest("File uploads are not allowed.");

      var spend = await TableService.GetSpendAsync(userEmail);
      if (spend >= userGroup.UserMaxWeeklySpend) return Results.StatusCode(429);

      Task<SummaryResponse> summaryTask = null;
      Conversation conversation = null;
      ConversationEntity conversationEntity = null;

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
        summaryTask = SummariseAsync(preset.Title, prompt, id);
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
      }
      if (!OpenAIConfig.Instance.Models.TryGetValue(conversation.Preset.Model, out var model))
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
            userTurn.Files.Add(new ConversationTurnFile { Content = base64Content, Filename = file.FileName, Type = file.ContentType });
          }
        }
      }
      conversation.Turns.Add(userTurn);
      var spendLimitReached = false;

      var hasTemp = conversation.Preset.Temperature is not null;
      var chatClient = _azureClient.GetOpenAIResponseClient(model.Name);
      var chatOptions = new ResponseCreationOptions
      {
        EndUserId = id,
        Instructions = conversation.Preset.Instructions,
        Temperature = hasTemp ? Convert.ToSingle(conversation.Preset.Temperature, CultureInfo.InvariantCulture) : null,
        ReasoningOptions = new() { ReasoningEffortLevel = conversation.Preset.ReasoningEffort },
        StoredOutputEnabled = false
      };

      var responseItems = conversation.AsResponseItems();
      var responseStream = chatClient.CreateResponseStreamingAsync(responseItems, chatOptions);

      return Results.Stream(async outputStream =>
      {
        await foreach (var update in responseStream)
        {
          switch (update)
          {
            case StreamingResponseOutputTextDeltaUpdate text:
              await StreamText(text.Delta);
              break;
            case StreamingResponseOutputItemAddedUpdate item when item.Item is ReasoningResponseItem:
              if (conversation.Preset.ReasoningEffort == "minimal") continue;
              await StreamText(":::[reasoning_in_progress]:::");
              break;
            case StreamingResponseOutputItemDoneUpdate item when item.Item is ReasoningResponseItem:
              if (conversation.Preset.ReasoningEffort == "minimal") continue;
              await StreamText(":::[reasoning_completed]:::");
              break;
            case StreamingResponseFileSearchCallSearchingUpdate:
              await StreamText(":::[file_search_in_progress]:::");
              break;
            case StreamingResponseFileSearchCallCompletedUpdate:
              await StreamText(":::[file_search_completed]:::");
              break;
            case StreamingResponseWebSearchCallInProgressUpdate:
              await StreamText(":::[web_search_in_progress]:::");
              break;
            case StreamingResponseWebSearchCallCompletedUpdate:
              await StreamText(":::[web_search_in_progress]:::");
              break;
            case StreamingResponseCompletedUpdate completion:
              await FinishStreamAsync(completion.Response.GetOutputText(), completion.Response.Usage, completion.Response.OutputItems);
              break;
            case StreamingResponseIncompleteUpdate filtered:
              await FinishStreamAsync(FlagToken, filtered.Response.Usage, filtered.Response.OutputItems);
              break;
            default:
              break;
          }
        }

        async Task StreamText(string text)
        {
          await outputStream.WriteAsync(Encoding.UTF8.GetBytes(text));
          await outputStream.FlushAsync();
        }

        async Task FinishStreamAsync(string text, ResponseTokenUsage usage, IList<ResponseItem> items)
        {
          conversation.Turns.Add(new() { Role = "assistant", Text = text });
          var cost = CalculateCost(model, usage, items.Count(item => item is FileSearchCallResponseItem));
          if (isFirstTurn)
          {
            string title;
            if (text == FlagToken)
            {
              title = $"{FlagIcon} Content flagged";
            }
            else
            {
              var summaryResponse = await summaryTask;
              cost += CalculateCost(OpenAIConfig.Instance.Models[OpenAIConfig.Instance.TitleSummarisationModel], summaryResponse.Usage);
              title = summaryResponse.Title;
            }
            conversationEntity = new ConversationEntity(userEmail, id, title, cost);
          }
          else
          {
            var existingCost = decimal.Parse(conversationEntity.Cost.ToString(), CultureInfo.InvariantCulture);
            conversationEntity.Cost = (existingCost + cost).ToString(CultureInfo.InvariantCulture);
            if (text == FlagToken)
            {
              conversationEntity.Title = $"{FlagIcon} {conversationEntity.Title}";
            }
          }
          var updateBlobTask = BlobService.CreateOrUpdateConversationAsync(id, conversation);
          var recordSpendTask = TableService.RecordSpendAsync(userEmail, cost, userGroupName);
          var updateEntityTask = TableService.UpsertConversationAsync(conversationEntity);
          var reviewTask = isReviewer
            ? Task.CompletedTask
            : TableService.UpsertReviewEntityAsync(conversationEntity, userGroupName);
          await Task.WhenAll(recordSpendTask, updateBlobTask, updateEntityTask, reviewTask);
          spendLimitReached = (await recordSpendTask) >= userGroup.UserMaxWeeklySpend;

          if (isFirstTurn)
          {
            await outputStream.WriteAsync(Encoding.UTF8.GetBytes($":::[conversation={id};{conversationEntity.Title}]:::"));
          }
          if (text == FlagToken)
          {
            await outputStream.WriteAsync(Encoding.UTF8.GetBytes($":::[flagged]:::"));
          }
          if (spendLimitReached)
          {
            await outputStream.WriteAsync(Encoding.UTF8.GetBytes($":::[spend_limit_reached]:::"));
          }
          await outputStream.FlushAsync();
        }
      }, "text/plain; charset=utf-8");
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
      client.DefaultRequestHeaders.Add("api-key", OpenAIConfig.Instance.AIFoundryApiKey);
      var request = new RealtimeSessionRequest
      {
        Model = preset.Model,
        Voice = preset.Voice,
        Instructions = preset.Instructions
      };
      var response = await client.PostAsJsonAsync("/openai/realtimeapi/sessions?api-version=2025-04-01-preview", request);
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
        if (!OpenAIConfig.Instance.Models.TryGetValue(preset.Model, out var model))
        {
          return Results.BadRequest("Model not supported.");
        }
        cost = CalculateSpeechCost(model, entry);

        var summaryResponse = await SummariseAsync(null, entry.UserTranscript, id);
        cost += CalculateCost(OpenAIConfig.Instance.Models[OpenAIConfig.Instance.TitleSummarisationModel], summaryResponse.Usage);
        title = summaryResponse.Title;

        conversationEntity = new ConversationEntity(userEmail, id, title, cost);
        await TableService.UpsertConversationAsync(conversationEntity);
        conversation = new Conversation { Preset = preset };
      }
      else
      {
        id = entry.CurrentChatId;
        conversationEntity = await TableService.GetConversationAsync(userEmail, id);
        conversation = await BlobService.GetConversationAsync(id);
        if (!OpenAIConfig.Instance.Models.TryGetValue(conversation.Preset.Model, out var model))
        {
          return Results.BadRequest("Model not supported.");
        }
        cost = CalculateSpeechCost(model, entry);
        var existingCost = decimal.Parse(conversationEntity.Cost.ToString(), CultureInfo.InvariantCulture);
        conversationEntity.Cost = (existingCost + cost).ToString(CultureInfo.InvariantCulture);
        await TableService.UpsertConversationAsync(conversationEntity);
      }

      conversation.Turns.Add(new ConversationTurn { Role = "user", Text = entry.UserTranscript, Timestamp = DateTime.UtcNow });
      conversation.Turns.Add(new ConversationTurn { Role = "assistant", Text = entry.AssistantTranscript, Timestamp = DateTime.UtcNow });
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

  private static async Task<SummaryResponse> SummariseAsync(string presetTitle, string prompt, string id)
  {
    var summaryClient = _azureClient.GetOpenAIResponseClient(OpenAIConfig.Instance.TitleSummarisationModel);
    var summaryOptions = new ResponseCreationOptions
    {
      EndUserId = id,
      Instructions = """
        The user will post a prompt. Do NOT respond to the prompt.      
        **Summarise it as succinctly as possible, in 3 words or less, for use as a conversation title in the UI.**
        The first word MUST start with a capital letter, and then use sentence case. Do not use punctuation. Prefer short words.
        Try to capture the full context of the query, not just the task category.
        Only respond with the plaintext title (3 words or less) and nothing else (no introduction or conclusion).
        """,
      ReasoningOptions = new() { ReasoningEffortLevel = "minimal" },
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

  private static decimal CalculateCost(OpenAIModelConfig model, ResponseTokenUsage usage, int fileSearchCount = 0)
  {
#if DEBUG
    return 0;
#else
    return ((usage.InputTokenCount - usage.InputTokenDetails.CachedTokenCount) * model.CostPer1MInputTokens / 1_000_000m) +
           (usage.InputTokenDetails.CachedTokenCount * model.CostPer1MCachedInputTokens / 1_000_000m) +
           (usage.OutputTokenCount * model.CostPer1MOutputTokens / 1_000_000m) +
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