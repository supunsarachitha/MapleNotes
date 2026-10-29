using Microsoft.Net.Http.Headers;

namespace MapleNotes.Server.Infrastructure.Web;

/// <summary>Security-related HTTP response headers applied to every response.</summary>
internal static class SecurityHeaders
{
    /// <summary>
    /// Content-Security-Policy for the application: scripts and workers only from this origin (no inline scripts, no
    /// <c>eval</c>), no plugins, no framing. Images and media may also come from <c>blob:</c> URLs for upload previews.
    /// </summary>
    /// <remarks>
    /// <c>'wasm-unsafe-eval'</c> lets the page and its workers compile WebAssembly, which the password derivation
    /// (Argon2id) needs. Despite its name it does not allow JavaScript <c>eval</c> or <c>new Function</c>.
    /// </remarks>
    public const string AppContentSecurityPolicy =
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' blob: data:; " +
        "media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; " +
        "form-action 'self'; frame-ancestors 'none'";

    /// <summary>
    /// Content-Security-Policy for attachment downloads: nothing may run, even if a file is opened directly.
    /// </summary>
    public const string AttachmentContentSecurityPolicy = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";

    /// <summary>
    /// Content-Security-Policy for the optional interactive API reference (<c>/scalar</c>). The page configures itself
    /// with an inline script, so inline scripts and styles are allowed here, but everything else stays as strict as the
    /// application's policy: code only from this origin, requests only to this origin, no plugins, no framing.
    /// </summary>
    public const string ApiReferenceContentSecurityPolicy =
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

    /// <summary>
    /// Adds the headers. Responses that already set a Content-Security-Policy (attachments) keep theirs. The optional
    /// API reference page (<c>/scalar</c>) needs inline scripts, so it gets its own, looser policy, but only while the
    /// reference is switched on: otherwise <c>/scalar</c> is an ordinary unknown route that serves the web app, which
    /// must keep the application policy. Every other response, including the OpenAPI document, gets the application
    /// policy. API responses are not stored by browsers
    /// (<c>Cache-Control: no-store</c>) unless they choose their own caching: they carry decrypted notes, and while an
    /// account changes to end-to-end encryption, plain text that must not linger on disk.
    /// </summary>
    /// <param name="app">The application pipeline.</param>
    /// <param name="apiReferenceEnabled">Whether the interactive API reference is mapped at <c>/scalar</c>.</param>
    /// <returns>The same pipeline.</returns>
    public static IApplicationBuilder UseMapleSecurityHeaders(this IApplicationBuilder app, bool apiReferenceEnabled) =>
        app.Use(async (context, next) =>
        {
            context.Response.OnStarting(() =>
            {
                var headers = context.Response.Headers;
                headers.XContentTypeOptions = "nosniff";
                headers.XFrameOptions = "DENY";
                headers["Referrer-Policy"] = "no-referrer";
                headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";
                headers["Cross-Origin-Opener-Policy"] = "same-origin";
                headers["Cross-Origin-Resource-Policy"] = "same-origin";

                if (context.Request.Path.StartsWithSegments("/api") && !headers.ContainsKey(HeaderNames.CacheControl))
                {
                    headers.CacheControl = "no-store";
                }

                if (!headers.ContainsKey(HeaderNames.ContentSecurityPolicy))
                {
                    headers.ContentSecurityPolicy = apiReferenceEnabled && context.Request.Path.StartsWithSegments("/scalar")
                        ? ApiReferenceContentSecurityPolicy
                        : AppContentSecurityPolicy;
                }

                return Task.CompletedTask;
            });

            await next(context);
        });

    /// <summary>
    /// Static-file options for the single-page app: fingerprinted files under <c>/assets</c> are cached for a year,
    /// everything else (notably <c>index.html</c>) is revalidated on every load so new releases appear immediately.
    /// </summary>
    public static StaticFileOptions SpaStaticFiles { get; } = new()
    {
        OnPrepareResponse = context =>
        {
            context.Context.Response.Headers.CacheControl = context.Context.Request.Path.StartsWithSegments("/assets")
                ? "public, max-age=31536000, immutable"
                : "no-cache";
        },
    };
}
