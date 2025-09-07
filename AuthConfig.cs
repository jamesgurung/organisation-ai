using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using System.Net;
using System.Security.Claims;

namespace OrgAI;

public static class AuthConfig
{
  public static void ConfigureAuth(this WebApplicationBuilder builder)
  {
    ArgumentNullException.ThrowIfNull(builder);
    builder.Services
      .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
      .AddCookie(o =>
      {
        o.Cookie.Path = "/";
        o.Cookie.HttpOnly = true;
        o.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        o.Cookie.SameSite = SameSiteMode.Lax;
        o.LoginPath = "/auth/login";
        o.LogoutPath = "/auth/logout";
        o.ExpireTimeSpan = TimeSpan.FromDays(60);
        o.SlidingExpiration = true;
        o.ReturnUrlParameter = "path";
        o.Events = new()
        {
          OnRedirectToAccessDenied = context =>
          {
            context.Response.StatusCode = 403;
            return Task.CompletedTask;
          },
          OnValidatePrincipal = async context =>
          {
            var issued = context.Properties.IssuedUtc;
            if (issued.HasValue && issued.Value > DateTimeOffset.UtcNow.AddDays(-1))
            {
              return;
            }
            if (UserExists(context.Principal.Identity.Name))
            {
              context.ShouldRenew = true;
            }
            else
            {
              context.RejectPrincipal();
              await context.HttpContext.SignOutAsync();
            }
          }
        };
      })
      .AddOpenIdConnect("Microsoft", o =>
      {
        o.Authority = $"https://login.microsoftonline.com/{builder.Configuration["Azure:TenantId"]}/v2.0/";
        o.ClientId = builder.Configuration["Azure:ClientId"];
        o.ClientSecret = builder.Configuration["Azure:ClientSecret"];
        o.ResponseType = OpenIdConnectResponseType.Code;
        o.MapInboundClaims = false;
        o.Scope.Clear();
        o.Scope.Add("openid");
        o.Scope.Add("profile");
        o.Events = new()
        {
          OnTicketReceived = context =>
          {
            var email = context.Principal.FindFirstValue("upn")?.ToLowerInvariant();
            if (UserExists(email))
            {
              var identity = new ClaimsIdentity(CookieAuthenticationDefaults.AuthenticationScheme);
              identity.AddClaim(new Claim(ClaimTypes.Name, email));
              context.Principal = new ClaimsPrincipal(identity);
            }
            else
            {
              context.Fail("Unauthorised");
              context.Response.Redirect("/auth/denied");
              context.HandleResponse();
            }
            return Task.CompletedTask;
          }
        };
      });

    builder.Services.AddAuthorizationBuilder().SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
  }

  private static bool UserExists(string email)
  {
    return !string.IsNullOrWhiteSpace(email) && UserGroup.GroupNameByUserEmail.ContainsKey(email);
  }

  private static readonly string[] authenticationSchemes = ["Microsoft"];

  public static void MapAuthPaths(this WebApplication app)
  {
    app.MapGet("/auth/login/challenge", [AllowAnonymous] ([FromQuery] string path) =>
    {
      var authProperties = new AuthenticationProperties { RedirectUri = path is null ? "/" : WebUtility.UrlDecode(path), AllowRefresh = true, IsPersistent = true };
      return Results.Challenge(authProperties, authenticationSchemes);
    });

    app.MapGet("/auth/logout", (HttpContext context) =>
    {
      context.SignOutAsync();
      return Results.Redirect("/auth/login");
    });
  }
}