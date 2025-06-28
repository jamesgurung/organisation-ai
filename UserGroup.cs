using System.Text.Json.Serialization;

namespace OrgAI;

public class UserGroup
{
  public static Dictionary<string, UserGroup> ConfigByGroupName { get; set; }
  public static Dictionary<string, string> GroupNameByUserEmail { get; set; }
  public static ILookup<string, string> GroupNamesByReviewerEmail { get; set; }

  [JsonPropertyName("showPresetDetails")]
  public bool ShowPresetDetails { get; set; }
  [JsonPropertyName("allowUploads")]
  public bool AllowUploads { get; set; }
  [JsonPropertyName("introMessage")]
  public string IntroMessage { get; set; }
  [JsonPropertyName("stopCommands")]
  public IList<StopCommand> StopCommands { get; set; }
  [JsonPropertyName("presets")]
  public IList<Preset> Presets { get; set; }
  [JsonPropertyName("userMaxWeeklySpend")]
  public decimal UserMaxWeeklySpend { get; init; }
  [JsonPropertyName("moderationThreshold")]
  public float ModerationThreshold { get; init; }
  [JsonPropertyName("reviewThreshold")]
  public float ReviewThreshold { get; init; }
  [JsonPropertyName("reviewers")]
  public IList<string> Reviewers { get; set; }
  [JsonIgnore]
  public Dictionary<string, Preset> PresetDictionary { get; set; }
  [JsonIgnore]
  public string PresetJson { get; set; }
  [JsonIgnore]
  public string ApiKey { get; set; }
}

public class StopCommand
{
  [JsonPropertyName("token")]
  public string Token { get; set; }
  [JsonPropertyName("message")]
  public string Message { get; set; }
}

public class Preset
{
  [JsonPropertyName("id")]
  public string Id { get; set; }
  [JsonPropertyName("title")]
  public string Title { get; set; }
  [JsonPropertyName("category")]
  public string Category { get; set; }
  [JsonPropertyName("introduction")]
  public string Introduction { get; set; }
  [JsonPropertyName("instructions"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public string Instructions { get; set; }
  [JsonPropertyName("model"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public string Model { get; set; }
  [JsonPropertyName("temperature"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public decimal? Temperature { get; set; }
  [JsonPropertyName("reasoningEffort"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public string ReasoningEffort { get; set; }
  [JsonPropertyName("webSearchEnabled"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
  public bool WebSearchEnabled { get; set; }
  [JsonPropertyName("vectorStoreId"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public string VectorStoreId { get; set; }
  [JsonPropertyName("voice"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public string Voice { get; set; }
}