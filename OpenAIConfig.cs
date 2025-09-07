namespace OrgAI;

public class OpenAIModelConfig
{
  public string Name { get; init; }
  public decimal CostPer1MInputTokens { get; init; }
  public decimal CostPer1MCachedInputTokens { get; init; }
  public decimal CostPer1MOutputTokens { get; init; }
  public decimal? CostPer1MAudioInputTokens { get; init; }
  public decimal? CostPer1MAudioOutputTokens { get; init; }
}

public class OpenAIConfig
{
  public static OpenAIConfig Instance { get; set; }

  public string AIFoundryApiKey { get; set; }
  public string AIFoundryEndpoint { get; set; }
  public string TitleSummarisationModel { get; set; }
  public Dictionary<string, OpenAIModelConfig> Models { get; set; }
}