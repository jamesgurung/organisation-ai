using OpenAI.Responses;
using System.Text.Json.Serialization;

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
            var uri = new Uri($"data:{image.Type};base64,{image.Content}");
            parts.Add(ResponseContentPart.CreateInputImagePart(uri));
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
          foreach (var reasoning in turn.EncryptedReasoningContent ?? [])
          {
            items.Add(new ReasoningResponseItem([]) { EncryptedContent = reasoning });
          }
          var sourceLines = (turn.Activities ?? [])
            .SelectMany(activity => activity.Sources ?? [])
            .Select(source =>
            {
              var title = string.IsNullOrWhiteSpace(source.Title) ? source.Filename : source.Title;
              if (string.IsNullOrWhiteSpace(source.Uri)) return title;
              return string.IsNullOrWhiteSpace(title) || string.Equals(title, source.Uri, StringComparison.Ordinal)
                ? source.Uri
                : $"{title}: {source.Uri}";
            })
            .Where(source => !string.IsNullOrWhiteSpace(source))
            .Distinct(StringComparer.Ordinal)
            .ToList();
          var assistantText = sourceLines.Count == 0
            ? turn.Text
            : $"{turn.Text}\n\nSources associated with this response:\n{string.Join("\n", sourceLines.Select(source => $"- {source}"))}";
          if ((turn.Images?.Count ?? 0) == 0)
          {
            items.Add(ResponseItem.CreateAssistantMessageItem(assistantText));
            break;
          }
          var assistantParts = new List<ResponseContentPart>(turn.Images.Count + 1)
          {
            ResponseContentPart.CreateOutputTextPart(assistantText, [])
          };
          foreach (var image in turn.Images)
          {
            var uri = new Uri($"data:{image.Type};base64,{image.Content}");
            assistantParts.Add(ResponseContentPart.CreateInputImagePart(uri));
          }
          items.Add(ResponseItem.CreateAssistantMessageItem(assistantParts));
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
  [JsonPropertyName("encryptedReasoningContent"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public IList<string> EncryptedReasoningContent { get; set; }
  [JsonPropertyName("activities"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public IList<ConversationActivity> Activities { get; set; }
  [JsonPropertyName("timestamp"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public DateTime? Timestamp { get; set; }
}

public class ConversationActivity
{
  [JsonPropertyName("id")]
  public string Id { get; set; }
  [JsonPropertyName("kind")]
  public string Kind { get; set; }
  [JsonPropertyName("durationMs")]
  public long DurationMs { get; set; }
  [JsonPropertyName("summary"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public string Summary { get; set; }
  [JsonPropertyName("sources"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public IList<ConversationActivitySource> Sources { get; set; }
}

public class ConversationActivitySource
{
  [JsonPropertyName("title")]
  public string Title { get; set; }
  [JsonPropertyName("uri"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public string Uri { get; set; }
  [JsonPropertyName("filename"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public string Filename { get; set; }
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
