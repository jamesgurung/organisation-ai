using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.AspNetCore.SignalR;
using OrgAI;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
  o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
  o.KnownNetworks.Clear();
  o.KnownProxies.Clear();
});

builder.Services.AddDataProtection().PersistKeysToAzureBlobStorage(new Uri(builder.Configuration["Azure:DataProtectionBlobUri"]));

var storageAccountName = builder.Configuration["Azure:StorageAccountName"];
var storageAccountKey = builder.Configuration["Azure:StorageAccountKey"];
var connectionString = $"DefaultEndpointsProtocol=https;AccountName={storageAccountName};AccountKey={storageAccountKey};EndpointSuffix=core.windows.net";
TableService.Configure(connectionString);
BlobService.Configure(connectionString);

await BlobService.LoadConfigAsync();

builder.ConfigureAuth();
builder.Services.AddResponseCompression();
builder.Services.AddAntiforgery(options => { options.HeaderName = "X-XSRF-TOKEN"; });
builder.Services.Configure<RouteOptions>(options => { options.LowercaseUrls = true; });
builder.Services.Configure<JsonOptions>(options => { options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase; });
builder.Services.AddRazorPages(options => { options.Conventions.AllowAnonymousToFolder("/auth"); });

Organisation.Instance = builder.Configuration.GetSection("Organisation").Get<Organisation>();
OpenAIConfig.Instance = builder.Configuration.GetSection("OpenAI").Get<OpenAIConfig>();

builder.Services.AddSingleton<IUserIdProvider, EmailUserIdProvider>();
builder.Services.AddSignalR();

var minify = !builder.Environment.IsDevelopment();
builder.Services.AddWebOptimizer(pipeline =>
{
  if (minify)
  {
    pipeline.MinifyCssFiles("css/*.css");
    pipeline.MinifyJsFiles("js/*.js");
    pipeline.AddFiles("text/javascript", "lib/marked/lib/marked.umd.min.js", "lib/signalr/dist/browser/signalr.min.js");
    pipeline.AddJavaScriptBundle("js/site.js", "js/main.js", "js/presets.js", "js/history.js", "js/chat.js", "js/streaming.js");
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
    }
    else if (!context.Request.Host.Host.Equals(Organisation.Instance.AppWebsite, StringComparison.OrdinalIgnoreCase))
    {
      context.Response.Redirect($"https://{Organisation.Instance.AppWebsite}{context.Request.Path.Value}{context.Request.QueryString}", true);
    }
    else
    {
      await next();
    }
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

app.MapHub<ChatHub>("/hub");
app.MapRazorPages();
app.MapAuthPaths();
app.MapApiPaths();

await app.RunAsync();