using Azure;
using Azure.Data.Tables;
using System.Globalization;
using System.Text.Json.Serialization;

namespace OrgAI;

public static class TableService
{
  private static TableClient _conversationsClient;
  private static TableClient _spendClient;
  private static TableClient _reviewClient;

  public static void Configure(string connectionString)
  {
    var tableServiceClient = new TableServiceClient(connectionString);
    _conversationsClient = tableServiceClient.GetTableClient("conversations");
    _spendClient = tableServiceClient.GetTableClient("spend");
    _reviewClient = tableServiceClient.GetTableClient("review");
  }

  public static async Task WarmUpAsync()
  {
    const string nonExistentKey = "warmup";
    await _conversationsClient.QueryAsync<TableEntity>(o => o.PartitionKey == nonExistentKey).ToListAsync();
    await _spendClient.QueryAsync<TableEntity>(o => o.PartitionKey == nonExistentKey).ToListAsync();
    await _reviewClient.QueryAsync<TableEntity>(o => o.PartitionKey == nonExistentKey).ToListAsync();
  }

  public static async Task UpsertConversationAsync(ConversationEntity conversation)
  {
    ArgumentNullException.ThrowIfNull(conversation);
    await _conversationsClient.UpsertEntityAsync(conversation, TableUpdateMode.Replace);
  }

  public static async Task<bool> ConversationExistsAsync(string userEmail, string conversationId)
  {
    ArgumentException.ThrowIfNullOrEmpty(userEmail);
    ArgumentException.ThrowIfNullOrEmpty(conversationId);
    var entity = await _conversationsClient.GetEntityIfExistsAsync<ConversationEntity>(userEmail, conversationId, select: ["RowKey"]);
    return entity.HasValue;
  }

  public static async Task<ConversationEntity> GetConversationAsync(string userEmail, string conversationId)
  {
    ArgumentNullException.ThrowIfNull(userEmail);
    ArgumentNullException.ThrowIfNull(conversationId);
    var entity = await _conversationsClient.GetEntityIfExistsAsync<ConversationEntity>(userEmail, conversationId);
    return !entity.HasValue || entity.Value.IsDeleted ? throw new InvalidOperationException("Conversation not found") : entity.Value;
  }

  public static async Task<List<ConversationEntity>> GetConversationsAsync(string userEmail, bool basicDataOnly)
  {
    ArgumentNullException.ThrowIfNull(userEmail);
    var query = _conversationsClient.QueryAsync<ConversationEntity>(c => c.PartitionKey == userEmail && !c.IsDeleted,
      select: basicDataOnly ? ["RowKey", "Title", "Timestamp"] : null);
    var conversations = await query.ToListAsync();
    return conversations.OrderByDescending(o => o.Timestamp).ToList();
  }

  public static async Task<List<ReviewEntity>> GetReviewEntitiesAsync(IEnumerable<string> userGroups)
  {
    var filters = userGroups.Select(g => TableClient.CreateQueryFilter($"PartitionKey eq {g}"));
    var filter = string.Join(" or ", filters);
    var query = _reviewClient.QueryAsync<ReviewEntity>(filter, select: ["PartitionKey", "RowKey", "User", "Title", "Timestamp"]);
    var reviewEntities = await query.ToListAsync();
    return reviewEntities.OrderByDescending(o => o.Timestamp).ToList();
  }

  public static async Task UpsertReviewEntityAsync(ConversationEntity conversation, string userGroup)
  {
    ArgumentNullException.ThrowIfNull(conversation);
    var reviewItem = new ReviewEntity
    {
      PartitionKey = userGroup,
      RowKey = conversation.RowKey,
      User = conversation.PartitionKey,
      Title = conversation.Title
    };
    await _reviewClient.UpsertEntityAsync(reviewItem, TableUpdateMode.Replace);
  }

  public static async Task<bool> ReviewExistsAsync(string userGroup, string conversationId)
  {
    ArgumentException.ThrowIfNullOrEmpty(userGroup);
    ArgumentException.ThrowIfNullOrEmpty(conversationId);
    var entity = await _reviewClient.GetEntityIfExistsAsync<ConversationEntity>(userGroup, conversationId, select: ["RowKey"]);
    return entity.HasValue;
  }

  public static async Task DeleteReviewEntityAsync(string userGroup, string conversationId)
  {
    ArgumentNullException.ThrowIfNull(conversationId);
    await _reviewClient.DeleteEntityAsync(userGroup, conversationId);
  }

  public static async Task DeleteConversationAsync(string userEmail, string conversationId)
  {
    ArgumentNullException.ThrowIfNull(userEmail);
    ArgumentNullException.ThrowIfNull(conversationId);
    await _conversationsClient.DeleteEntityAsync(userEmail, conversationId);
  }

  public static async Task<decimal> RecordSpendAsync(string userEmail, decimal amount, string userGroup)
  {
    ArgumentNullException.ThrowIfNull(userEmail);
    var weekStart = GetCurrentWeekStart();
    for (var attempt = 0; attempt < 3; attempt++)
    {
      var userSpend = await _spendClient.GetEntityIfExistsAsync<SpendEntity>(weekStart, userEmail);
      if (userSpend.HasValue)
      {
        var existingSpend = decimal.Parse(userSpend.Value.Spent, CultureInfo.InvariantCulture);
        var newSpend = existingSpend + amount;
        userSpend.Value.Spent = newSpend.ToString(CultureInfo.InvariantCulture);
        try
        {
          await _spendClient.UpdateEntityAsync(userSpend.Value, userSpend.Value.ETag);
          return newSpend;
        }
        catch (RequestFailedException ex) when (ex.Status == 412)
        {
          continue;
        }
      }
      else
      {
        var newEntity = new SpendEntity
        {
          PartitionKey = weekStart,
          RowKey = userEmail,
          Spent = amount.ToString(CultureInfo.InvariantCulture),
          UserGroup = userGroup
        };
        try
        {
          await _spendClient.AddEntityAsync(newEntity);
          return amount;
        }
        catch (RequestFailedException ex) when (ex.Status == 409)
        {
          continue;
        }
      }
    }

    throw new InvalidOperationException("Could not record spend after 3 attempts.");
  }

  public static async Task<decimal> GetSpendAsync(string userEmail)
  {
    ArgumentNullException.ThrowIfNull(userEmail);
    var weekStart = GetCurrentWeekStart();
    var userSpend = await _spendClient.GetEntityIfExistsAsync<SpendEntity>(weekStart, userEmail);
    return userSpend.HasValue ? decimal.Parse(userSpend.Value.Spent, CultureInfo.InvariantCulture) : 0m;
  }

  public static async Task<List<SpendEntity>> GetUsageDataAsync(IList<string> userGroups)
  {
    var filters = userGroups.Select(g => TableClient.CreateQueryFilter($"UserGroup eq {g}"));
    var filter = string.Join(" or ", filters);
    var query = _spendClient.QueryAsync<SpendEntity>(filter, select: ["PartitionKey", "RowKey", "Spent", "UserGroup"]);
    var spendEntities = await query.ToListAsync();
    return spendEntities.OrderBy(o => o.PartitionKey).ThenBy(o => o.UserGroup).ThenByDescending(o => o.Spent).ThenBy(o => o.RowKey).ToList();
  }

  private static string GetCurrentWeekStart()
  {
    var now = DateTime.UtcNow;
    var startOfWeek = now.AddDays(-(int)now.DayOfWeek);
    return startOfWeek.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
  }
}

public class ConversationEntity : ITableEntity
{
  [JsonIgnore]
  public string PartitionKey { get; set; }
  [JsonPropertyName("id")]
  public string RowKey { get; set; }
  [JsonIgnore]
  public DateTimeOffset? Timestamp { get; set; }
  [JsonIgnore]
  public ETag ETag { get; set; }

  [JsonPropertyName("title")]
  public string Title { get; set; }
  [JsonIgnore]
  public string Cost { get; set; }
  [JsonIgnore]
  public bool IsDeleted { get; set; }

  public ConversationEntity() { }

  public ConversationEntity(string userEmail, string conversationId, string title, decimal cost)
  {
    PartitionKey = userEmail;
    RowKey = conversationId;
    Title = title;
    Cost = cost.ToString(CultureInfo.InvariantCulture);
  }
}

public class SpendEntity : ITableEntity
{
  [JsonPropertyName("week")]
  public string PartitionKey { get; set; }
  [JsonPropertyName("user")]
  public string RowKey { get; set; }
  [JsonIgnore]
  public DateTimeOffset? Timestamp { get; set; }
  [JsonIgnore]
  public ETag ETag { get; set; }

  [JsonPropertyName("spend")]
  public string Spent { get; set; }
  [JsonPropertyName("group")]
  public string UserGroup { get; set; }
}

public class ReviewEntity : ITableEntity
{
  [JsonPropertyName("group")]
  public string PartitionKey { get; set; }
  [JsonPropertyName("id")]
  public string RowKey { get; set; }
  [JsonIgnore]
  public DateTimeOffset? Timestamp { get; set; }
  [JsonIgnore]
  public ETag ETag { get; set; }

  [JsonPropertyName("user")]
  public string User { get; set; }
  [JsonPropertyName("title")]
  public string Title { get; set; }
}

public static class QueryExtensions
{
  public static async Task<List<T>> ToListAsync<T>(this AsyncPageable<T> query)
  {
    ArgumentNullException.ThrowIfNull(query);
    var list = new List<T>();
    await foreach (var item in query)
      list.Add(item);
    return list;
  }
}
