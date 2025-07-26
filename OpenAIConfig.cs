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

  public decimal CostPer1KFileSearches { get; set; }
  public string TitleSummarisationModel { get; set; }

  private IList<OpenAIModelConfig> _models;
  public IList<OpenAIModelConfig> Models
  {
    get => _models;
    set
    {
      _models = value;
      ModelDictionary = _models.ToDictionary(m => m.Name, m => m);
    }
  }
  public Dictionary<string, OpenAIModelConfig> ModelDictionary { get; set; }
}