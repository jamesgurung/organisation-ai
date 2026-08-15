using Azure.Identity;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.AspNetCore.HttpOverrides;
using OrgAI;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);

var appConfigEndpoint = builder.Configuration["AppConfigurationEndpoint"];
var appConfigConnectionString = builder.Configuration.GetConnectionString("AppConfiguration");
if (appConfigEndpoint is not null || appConfigConnectionString is not null)
{
  builder.Configuration.AddAzureAppConfiguration(options =>
  {
    if (appConfigEndpoint is not null)
    {
      options.Connect(new Uri(appConfigEndpoint), new ManagedIdentityCredential(ManagedIdentityId.SystemAssigned));
    }
    else
    {
      options.Connect(appConfigConnectionString);
    }
    options
      .Select("Shared:*")
      .Select("OrgAI:*")
      .TrimKeyPrefix("Shared:")
      .TrimKeyPrefix("OrgAI:");
  });
}

builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
  o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
  o.KnownIPNetworks.Clear();
  o.KnownProxies.Clear();
});

builder.Services.AddDataProtection().PersistKeysToAzureBlobStorage(new Uri(builder.Configuration["DataProtectionBlobUri"]));

var storageAccountName = builder.Configuration["StorageAccountName"];
var storageAccountKey = builder.Configuration["StorageAccountKey"];
var connectionString = $"DefaultEndpointsProtocol=https;AccountName={storageAccountName};AccountKey={storageAccountKey};EndpointSuffix=core.windows.net";
TableService.Configure(connectionString);
BlobService.Configure(connectionString);

Organisation.Instance = builder.Configuration.Get<Organisation>();
OpenAIConfig.Instance = builder.Configuration.Get<OpenAIConfig>();

Api.Configure();
await BlobService.LoadConfigAsync();

builder.ConfigureAuth();
builder.Services.AddResponseCompression(options => options.EnableForHttps = true);
builder.Services.AddAntiforgery(options => options.HeaderName = "X-XSRF-TOKEN");
builder.Services.Configure<RouteOptions>(options => options.LowercaseUrls = true);
builder.Services.Configure<JsonOptions>(options => options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase);
builder.Services.AddRazorPages(options => options.Conventions.AllowAnonymousToFolder("/auth"));

builder.Services.AddHttpClient("OpenAI", client => client.BaseAddress = Api.GetFoundryOpenAIEndpoint());
builder.Services.AddWebOptimizer(pipeline =>
{
  if (!builder.Environment.IsDevelopment())
  {
    pipeline.MinifyCssFiles("css/*.css");
    pipeline.MinifyJsFiles("js/*.js");
    pipeline.AddFiles("text/javascript", "lib/marked/lib/marked.umd.min.js", "lib/chart.js/dist/chart.umd.min.js", "lib/mathjax/tex-chtml.min.js");
    pipeline.AddJavaScriptBundle("js/site.js", "js/main.js", "js/presets.js", "js/history.js", "js/chat.js", "js/streaming.js", "js/speech.js");
  }
});

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
  app.UseHsts();
  app.Use(async (context, next) =>
  {
    if (context.Request.Path.Value == "/" && context.Request.Headers.UserAgent.ToString().Equals("alwayson", StringComparison.OrdinalIgnoreCase))
    {
      await TableService.WarmUpAsync();
      context.Response.StatusCode = 200;
      return;
    }

    if (!context.Request.Host.Host.Equals(Organisation.Instance.AppWebsite, StringComparison.OrdinalIgnoreCase))
    {
      context.Response.Redirect($"https://{Organisation.Instance.AppWebsite}{context.Request.Path.Value}{context.Request.QueryString}", true);
      return;
    }

    await next();
  });
}

app.UseForwardedHeaders();
app.UseResponseCompression();
app.UseHttpsRedirection();
app.UseWebOptimizer();
app.UseStaticFiles();
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.UseAntiforgery();

app.MapRazorPages();
app.MapAuthPaths();
app.MapApiPaths();

await app.RunAsync();
