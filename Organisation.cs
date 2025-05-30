namespace OrgAI;

public class Organisation
{
  public static Organisation Instance { get; set; }

  public string Name { get; init; }
  public string AppWebsite { get; init; }
  public string CountryCode { get; init; }
  public string City { get; init; }
  public string Timezone { get; init; }
  public string SyncApiKey { get; init; }
}