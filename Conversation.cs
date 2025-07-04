using OpenAI.Responses;
using System.Text.Json.Serialization;

#pragma warning disable OPENAI001

namespace OrgAI;

public class Conversation
{
  [JsonPropertyName("preset")]
  public Preset Preset { get; set; }
  [JsonPropertyName("turns")]
  public IList<ConversationTurn> Turns { get; set; } = [];

  public IList<ResponseItem> AsResponseItems()
  {
    var items = new List<ResponseItem>(Turns.Count);
    foreach (var turn in Turns)
    {
      switch (turn.Role)
      {
        case "user":
          var parts = new List<ResponseContentPart>((turn.Images?.Count ?? 0) + (turn.Files?.Count ?? 0) + 1);
          foreach (var image in turn.Images ?? [])
          {
            var content = new BinaryData(Convert.FromBase64String(image.Content));
            parts.Add(ResponseContentPart.CreateInputImagePart(content, image.Type));
          }
          foreach (var file in turn.Files ?? [])
          {
            var content = new BinaryData(Convert.FromBase64String(file.Content));
            parts.Add(ResponseContentPart.CreateInputFilePart(content, file.Type, file.Filename));
          }
          parts.Add(ResponseContentPart.CreateInputTextPart(turn.Text));
          items.Add(ResponseItem.CreateUserMessageItem(parts));
          break;
        case "assistant":
          items.Add(ResponseItem.CreateAssistantMessageItem(turn.Text));
          break;
        default:
          throw new InvalidOperationException($"Unknown role: {turn.Role}.");
      }
    }
    return items;
  }
}

public class ConversationTurn
{
  [JsonPropertyName("role")]
  public string Role { get; set; }
  [JsonPropertyName("text")]
  public string Text { get; set; }
  [JsonPropertyName("images"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public IList<ConversationTurnImage> Images { get; set; }
  [JsonPropertyName("files"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public IList<ConversationTurnFile> Files { get; set; }
  [JsonPropertyName("timestamp"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public DateTime? Timestamp { get; set; }
}

public class ConversationTurnImage
{
  [JsonPropertyName("content")]
  public string Content { get; set; }
  [JsonPropertyName("type")]
  public string Type { get; set; }
}

public class ConversationTurnFile
{
  [JsonPropertyName("content")]
  public string Content { get; set; }
  [JsonPropertyName("filename")]
  public string Filename { get; set; }
  [JsonPropertyName("type")]
  public string Type { get; set; }
}