using System.Text.Json.Serialization;

namespace OrgAI;

public class RealtimeSessionRequest
{
  [JsonPropertyName("session")]
  public RealtimeSession Session { get; set; } = new();
}

public class RealtimeSession
{
  [JsonPropertyName("type")]
  public string Type { get; set; } = "realtime";
  [JsonPropertyName("model")]
  public string Model { get; set; }
  [JsonPropertyName("instructions")]
  [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public string Instructions { get; set; }
  [JsonPropertyName("audio")]
  public RealtimeSessionAudio Audio { get; set; } = new();
}

public class RealtimeSessionAudio
{
  [JsonPropertyName("input")]
  public RealtimeSessionInputAudio Input { get; set; } = new();
  [JsonPropertyName("output")]
  public RealtimeSessionOutputAudio Output { get; set; } = new();
}

public class RealtimeSessionInputAudio
{
  [JsonPropertyName("noise_reduction")]
  public RealtimeSessionInputAudioNoiseReduction NoiseReduction { get; set; } = new();
  [JsonPropertyName("transcription")]
  public RealtimeSessionInputAudioTranscription Transcription { get; set; } = new();
  [JsonPropertyName("turn_detection")]
  public RealtimeSessionTurnDetection TurnDetection { get; set; } = new();
}

public class RealtimeSessionOutputAudio
{
  [JsonPropertyName("voice")]
  [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
  public string Voice { get; set; }
}

public class RealtimeSessionInputAudioNoiseReduction
{
  [JsonPropertyName("type")]
  public string Type { get; set; } = "far_field";
}

public class RealtimeSessionInputAudioTranscription
{
  [JsonPropertyName("language")]
  public string Language { get; set; } = "en";
  [JsonPropertyName("model")]
  public string Model { get; set; } = "gpt-4o-mini-transcribe";
}

public class RealtimeSessionTurnDetection
{
  [JsonPropertyName("type")]
  public string Type { get; set; } = "semantic_vad";
}

public class RealtimeConversationEntry
{
  [JsonPropertyName("presetId")]
  public string PresetId { get; set; }
  [JsonPropertyName("currentChatId")]
  public string CurrentChatId { get; set; }
  [JsonPropertyName("inputAudioTokens")]
  public int InputAudioTokens { get; set; }
  [JsonPropertyName("inputTextTokens")]
  public int InputTextTokens { get; set; }
  [JsonPropertyName("cachedInputAudioTokens")]
  public int CachedInputAudioTokens { get; set; }
  [JsonPropertyName("cachedInputTextTokens")]
  public int CachedInputTextTokens { get; set; }
  [JsonPropertyName("outputAudioTokens")]
  public int OutputAudioTokens { get; set; }
  [JsonPropertyName("outputTextTokens")]
  public int OutputTextTokens { get; set; }
  [JsonPropertyName("userTranscript")]
  public string UserTranscript { get; set; }
  [JsonPropertyName("assistantTranscript")]
  public string AssistantTranscript { get; set; }
}
