using Azure;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Blobs.Specialized;
using System.Text.Json;

namespace OrgAI;

public static class BlobService
{
  private static BlobContainerClient _conversationsClient;
  private static BlobContainerClient _configClient;
  private static readonly JsonSerializerOptions _jsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

  public static void Configure(string connectionString)
  {
    var blobClient = new BlobServiceClient(connectionString);
    _conversationsClient = blobClient.GetBlobContainerClient("conversations");
    _configClient = blobClient.GetBlobContainerClient("config");
  }

  public static async Task CreateOrUpdateConversationAsync(string conversationId, Conversation conversation)
  {
    ArgumentNullException.ThrowIfNull(conversationId);
    ArgumentNullException.ThrowIfNull(conversation);
    var contents = JsonSerializer.Serialize(conversation);
    var blob = _conversationsClient.GetBlobClient(conversationId);
    await blob.UploadAsync(new BinaryData(contents), overwrite: true);
  }

  public static async Task<Conversation> GetConversationAsync(string conversationId)
  {
    return (await GetConversationSnapshotAsync(conversationId)).Conversation;
  }

  public static async Task<ConversationSnapshot> GetConversationSnapshotAsync(string conversationId)
  {
    ArgumentNullException.ThrowIfNull(conversationId);
    var blob = _conversationsClient.GetBlobClient(conversationId);
    try
    {
      var response = await blob.DownloadContentAsync();
      var json = response.Value.Content.ToString();
      return new(JsonSerializer.Deserialize<Conversation>(json), response.Value.Details.ETag, response.Value.Content);
    }
    catch (RequestFailedException ex) when (ex.Status == 404)
    {
      throw new InvalidOperationException("Conversation not found", ex);
    }
  }

  public static async Task UpdateConversationAsync(string conversationId, Conversation conversation, ConversationSnapshot expectedSnapshot, Func<Task> updateMetadataAsync)
  {
    ArgumentNullException.ThrowIfNull(conversationId);
    ArgumentNullException.ThrowIfNull(conversation);
    ArgumentNullException.ThrowIfNull(expectedSnapshot);
    ArgumentNullException.ThrowIfNull(updateMetadataAsync);
    var contents = new BinaryData(JsonSerializer.Serialize(conversation));
    var blob = _conversationsClient.GetBlobClient(conversationId);
    var lease = blob.GetBlobLeaseClient();
    var leaseAcquired = false;
    try
    {
      await lease.AcquireAsync(TimeSpan.FromSeconds(60), cancellationToken: CancellationToken.None);
      leaseAcquired = true;
      var properties = await blob.GetPropertiesAsync(new BlobRequestConditions { LeaseId = lease.LeaseId }, CancellationToken.None);
      if (properties.Value.ETag != expectedSnapshot.ETag)
        throw new RequestFailedException(412, "The conversation was updated elsewhere.");

      var upload = await blob.UploadAsync(contents, new BlobUploadOptions
      {
        Conditions = new BlobRequestConditions { IfMatch = expectedSnapshot.ETag, LeaseId = lease.LeaseId }
      }, CancellationToken.None);
      try
      {
        await updateMetadataAsync();
      }
      catch (Exception metadataException)
      {
        try
        {
          await blob.UploadAsync(expectedSnapshot.Content, new BlobUploadOptions
          {
            Conditions = new BlobRequestConditions { IfMatch = upload.Value.ETag, LeaseId = lease.LeaseId }
          }, CancellationToken.None);
        }
        catch (Exception rollbackException)
        {
          throw new AggregateException("Failed to update conversation metadata and restore the previous conversation.", metadataException, rollbackException);
        }
        throw;
      }
    }
    finally
    {
      if (leaseAcquired)
      {
        try
        {
          await lease.ReleaseAsync(cancellationToken: CancellationToken.None);
        }
        catch (RequestFailedException ex) when (ex.Status is 404 or 409 or 412)
        {
        }
      }
    }
  }

  public static async Task DeleteConversationAsync(string conversationId)
  {
    ArgumentNullException.ThrowIfNull(conversationId);
    var blob = _conversationsClient.GetBlobClient(conversationId);
    await blob.DeleteIfExistsAsync();
  }

  public static async Task LoadConfigAsync()
  {
    var usersData = await _configClient.GetBlobClient("users.csv").DownloadContentAsync();
    UserGroup.GroupNameByUserEmail = usersData.Value.Content.ToString().Trim().Split('\n').Skip(1).Select(line => line.Split(','))
      .ToDictionary(o => o[0].ToLowerInvariant().Trim(), o => o[1].ToLowerInvariant().Trim());

    var userGroupNames = UserGroup.GroupNameByUserEmail.Values.Distinct().ToList();
    UserGroup.ConfigByGroupName = new Dictionary<string, UserGroup>(userGroupNames.Count);
    foreach (var userGroupName in userGroupNames)
    {
      var blob = _configClient.GetBlobClient($"{userGroupName}.json");
      try
      {
        var response = await blob.DownloadContentAsync();
        var json = response.Value.Content.ToString();
        var userGroup = JsonSerializer.Deserialize<UserGroup>(json);
        userGroup.PresetDictionary = userGroup.Presets.ToDictionary(p => p.Id, p => p);
        if (userGroup.ShowPresetDetails)
        {
          userGroup.PresetJson = JsonSerializer.Serialize(userGroup.Presets);
        }
        else
        {
          var redactedPresets = userGroup.Presets
            .Select(preset => new Preset
            {
              Id = preset.Id,
              Title = preset.Title,
              Category = preset.Category,
              Introduction = preset.Introduction,
              MaxTurns = preset.MaxTurns,
              Voice = preset.Voice
            })
            .ToList();
          userGroup.PresetJson = JsonSerializer.Serialize(redactedPresets);
        }
        userGroup.StopCommands ??= [];
        userGroup.StopCommands.Add(new StopCommand
        {
          Token = Api.FlagToken,
          Message = "# This conversation has been flagged for review.\n\n" +
            "Our system detected content that may violate our usage policies. Please ensure that all conversations remain respectful and appropriate, avoiding sensitive topics."
        });

        UserGroup.ConfigByGroupName[userGroupName] = userGroup;
      }
      catch (RequestFailedException ex) when (ex.Status == 404)
      {
        throw new InvalidOperationException($"User group '{userGroupName}' not found", ex);
      }
    }
    UserGroup.GroupNamesByReviewerEmail = UserGroup.ConfigByGroupName
      .SelectMany(g => g.Value.Reviewers, (g, r) => new { ReviewerEmail = r, GroupName = g.Key })
      .ToLookup(o => o.ReviewerEmail, o => o.GroupName, StringComparer.OrdinalIgnoreCase);

    var modelsData = await _configClient.GetBlobClient("models.json").DownloadContentAsync();
    var models = JsonSerializer.Deserialize<List<OpenAIModelConfig>>(modelsData.Value.Content.ToString(), _jsonOptions);
    OpenAIConfig.Instance.Models = models.ToDictionary(m => m.Name, m => m);
  }

  public static async Task UpdateUsersAsync(string csvContent)
  {
    ArgumentNullException.ThrowIfNull(csvContent);
    var blob = _configClient.GetBlobClient("users.csv");
    await blob.UploadAsync(new BinaryData(csvContent), true);
  }
}

public record ConversationSnapshot(Conversation Conversation, ETag ETag, BinaryData Content);
