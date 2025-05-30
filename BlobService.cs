using Azure;
using Azure.Storage.Blobs;
using System.Text.Json;

namespace OrgAI;

public static class BlobService
{
  public static void Configure(string connectionString)
  {
    var blobClient = new BlobServiceClient(connectionString);
    conversationsClient = blobClient.GetBlobContainerClient("conversations");
    configClient = blobClient.GetBlobContainerClient("config");
  }

  private static BlobContainerClient conversationsClient;
  private static BlobContainerClient configClient;

  public static async Task CreateOrUpdateConversationAsync(string conversationId, Conversation conversation)
  {
    ArgumentNullException.ThrowIfNull(conversationId);
    ArgumentNullException.ThrowIfNull(conversation);
    var contents = JsonSerializer.Serialize(conversation);
    var blob = conversationsClient.GetBlobClient(conversationId);
    await blob.UploadAsync(new BinaryData(contents), overwrite: true);
  }

  public static async Task<Conversation> GetConversationAsync(string conversationId)
  {
    ArgumentNullException.ThrowIfNull(conversationId);
    var blob = conversationsClient.GetBlobClient(conversationId);
    try
    {
      var response = await blob.DownloadContentAsync();
      var json = response.Value.Content.ToString();
      return JsonSerializer.Deserialize<Conversation>(json);
    }
    catch (RequestFailedException ex) when (ex.Status == 404)
    {
      throw new InvalidOperationException("Conversation not found", ex);
    }
  }

  public static async Task DeleteConversationAsync(string conversationId)
  {
    ArgumentNullException.ThrowIfNull(conversationId);
    var blob = conversationsClient.GetBlobClient(conversationId);
    await blob.DeleteIfExistsAsync();
  }

  public static async Task LoadConfigAsync()
  {
    var usersData = await configClient.GetBlobClient("users.csv").DownloadContentAsync();
    UserGroup.GroupNameByUserEmail = usersData.Value.Content.ToString().Trim().Split('\n').Skip(1).Select(line => line.Split(','))
      .ToDictionary(o => o[0].ToLowerInvariant().Trim(), o => o[1].ToLowerInvariant().Trim());

    var userGroupNames = UserGroup.GroupNameByUserEmail.Values.Distinct().ToList();
    UserGroup.ConfigByGroupName = new Dictionary<string, UserGroup>(userGroupNames.Count);
    foreach (var userGroupName in userGroupNames)
    {
      var blob = configClient.GetBlobClient($"{userGroupName}.json");
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
          var redactedPresets = new List<Preset>();
          foreach (var preset in userGroup.Presets)
          {
            redactedPresets.Add(new Preset
            {
              Id = preset.Id,
              Title = preset.Title,
              Category = preset.Category,
              Introduction = preset.Introduction
            });
          }
          userGroup.PresetJson = JsonSerializer.Serialize(redactedPresets);
        }
        userGroup.StopCommands ??= [];
        userGroup.StopCommands.Add(new StopCommand
        {
          Token = Api.FlagToken,
          Message = "# This conversation has been flagged for review.\n\n" +
            "Our system detected content that may violate our usage policies. Please ensure that all conversations remain respectful and appropriate, avoiding sensitive topics."
        });
        userGroup.ApiKey = OpenAIConfig.Instance.ApiKeys?.FirstOrDefault(o => string.Equals(o.UserGroup, userGroupName, StringComparison.OrdinalIgnoreCase))?.Key
          ?? OpenAIConfig.Instance.DefaultApiKey;

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
  }

  public static async Task UpdateUsersAsync(string csvContent)
  {
    ArgumentNullException.ThrowIfNull(csvContent);
    var blob = configClient.GetBlobClient("users.csv");
    await blob.UploadAsync(new BinaryData(csvContent), true);
  }
}