using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Infrastructure.Configuration;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Authorization;
using Microsoft.AspNetCore.RateLimiting;

namespace MapleNotes.Server.Infrastructure.Web;

/// <summary>Registers the HTTP layer: API controllers, authentication, antiforgery and rate limiting.</summary>
internal static class WebServiceCollectionExtensions
{
    /// <summary>Name of the session cookie.</summary>
    public const string SessionCookieName = "maple.session";

    /// <summary>Name of the antiforgery cookie.</summary>
    public const string AntiforgeryCookieName = "maple.antiforgery";

    /// <summary>Header that carries the antiforgery token.</summary>
    public const string AntiforgeryHeaderName = "X-XSRF-TOKEN";

    /// <summary>Adds the HTTP layer services.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same service collection.</returns>
    public static IServiceCollection AddMapleWeb(this IServiceCollection services)
    {
        services.AddProblemDetails();
        services
            .AddControllers(mvc =>
            {
                // Secure by default: every API endpoint requires a signed-in user unless marked [AllowAnonymous],
                // and every state-changing request must carry a valid antiforgery token.
                mvc.Filters.Add(new AuthorizeFilter());
                mvc.Filters.Add<AntiforgeryValidationFilter>();
                mvc.Filters.Add<ApiValidationExceptionFilter>();
            })
            .AddJsonOptions(json => json.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));

        services.AddAntiforgery(antiforgery =>
        {
            antiforgery.HeaderName = AntiforgeryHeaderName;
            antiforgery.Cookie.Name = AntiforgeryCookieName;
            antiforgery.Cookie.SameSite = SameSiteMode.Strict;
            antiforgery.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        });

        services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
            .AddCookie(cookie =>
            {
                cookie.Cookie.Name = SessionCookieName;
                cookie.Cookie.HttpOnly = true;
                cookie.Cookie.SameSite = SameSiteMode.Strict;
                cookie.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest; // Secure over HTTPS (incl. via a trusted proxy)
                cookie.ExpireTimeSpan = TimeSpan.FromDays(30);
                cookie.SlidingExpiration = true;
                cookie.Events = new CookieAuthenticationEvents
                {
                    OnValidatePrincipal = UserPrincipal.ValidateAsync,

                    // An API answers with status codes; redirects to a login page are for server-rendered sites.
                    OnRedirectToLogin = context =>
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        return Task.CompletedTask;
                    },
                    OnRedirectToAccessDenied = context =>
                    {
                        context.Response.StatusCode = StatusCodes.Status403Forbidden;
                        return Task.CompletedTask;
                    },
                };
            });
        services.AddAuthorization();

        services.Configure<PasswordHasherOptions>(hasher =>
        {
            hasher.CompatibilityMode = PasswordHashing.Options.CompatibilityMode;
            hasher.IterationCount = PasswordHashing.IterationCount;
        });
        services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();

        services.AddOpenApi();

        services.AddRateLimiter(_ => { });
        services.AddOptions<RateLimiterOptions>().Configure<MapleOptions>((limiter, options) =>
        {
            limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            limiter.AddPolicy(RateLimitPolicies.Authentication, context => RateLimitPartition.GetFixedWindowLimiter(
                context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = options.AuthenticationRateLimit,
                    Window = TimeSpan.FromMinutes(1),
                    QueueLimit = 0,
                }));
        });

        // Behind a reverse proxy, the client address and scheme arrive in X-Forwarded-* headers. They are trusted only
        // from the proxies listed in MAPLE_TRUSTED_PROXIES; with none listed they are ignored.
        services.AddOptions<ForwardedHeadersOptions>().Configure<MapleOptions>((forwarded, options) =>
        {
            forwarded.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            forwarded.KnownIPNetworks.Clear();
            forwarded.KnownProxies.Clear();
            foreach (var network in options.TrustedProxies)
            {
                forwarded.KnownIPNetworks.Add(network);
            }
        });

        return services;
    }
}
