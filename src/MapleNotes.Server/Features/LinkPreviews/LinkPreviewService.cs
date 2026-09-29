using System.Net;
using System.Net.Http.Headers;
using System.Text;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.Extensions.Caching.Memory;

namespace MapleNotes.Server.Features.LinkPreviews;

/// <summary>A preview of a web page linked from a note.</summary>
/// <param name="Url">The page's address.</param>
/// <param name="Title">Its title.</param>
/// <param name="Description">Its description, if it has one.</param>
/// <param name="SiteName">The site's name (or host).</param>
public sealed record LinkPreviewResponse(string Url, string Title, string? Description, string SiteName);

/// <summary>
/// Fetches previews of links: only public http(s) addresses on the standard ports, HTML only, a few seconds and at
/// most 512 KB per page, following at most three redirects (each checked again). Results, including "no preview", are
/// cached, so a link is fetched at most once a day however often it is shown.
/// </summary>
/// <param name="http">Creates the preview client (see <see cref="ClientName"/>).</param>
/// <param name="cache">Cache of previews.</param>
/// <param name="logger">Logger.</param>
public sealed class LinkPreviewService(IHttpClientFactory http, IMemoryCache cache, ILogger<LinkPreviewService> logger)
{
    /// <summary>The named HTTP client; its handler connects only to public addresses (<see cref="NetworkGuard"/>).</summary>
    public const string ClientName = "link-preview";

    /// <summary>The most of a page that is read.</summary>
    public const int MaxBytes = 512 * 1024;

    private const int MaxRedirects = 3;

    /// <summary>Returns the preview of a link.</summary>
    /// <param name="url">The link.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The preview, or null when the page cannot be previewed.</returns>
    /// <exception cref="ApiValidationException">The link is not one that may be fetched.</exception>
    public async Task<LinkPreviewResponse?> GetAsync(string url, CancellationToken cancellationToken)
    {
        var uri = Validate(url) is { } error ? throw new ApiValidationException("url", error) : new Uri(url);
        var key = $"link-preview:{uri.AbsoluteUri}";
        if (cache.TryGetValue(key, out LinkPreviewResponse? cached))
        {
            return cached;
        }

        LinkPreviewResponse? preview = null;
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(5));
            preview = await FetchAsync(uri, timeout.Token);
        }
        catch (Exception ex) when (ex is HttpRequestException or BlockedAddressException or IOException or InvalidOperationException
            || (ex is OperationCanceledException && !cancellationToken.IsCancellationRequested))
        {
            logger.LogDebug(ex, "No preview for {Host}.", uri.Host);
        }

        cache.Set(key, preview, preview is null ? TimeSpan.FromMinutes(10) : TimeSpan.FromDays(1));
        return preview;
    }

    /// <summary>Checks that a link may be fetched.</summary>
    /// <param name="url">The link.</param>
    /// <returns>Why it may not, or null.</returns>
    public static string? Validate(string? url)
    {
        if (url is null || url.Length > 2048 || !Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            return "This is not a web address.";
        }

        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
        {
            return "Only http and https links have previews.";
        }

        if (!uri.IsDefaultPort || !string.IsNullOrEmpty(uri.UserInfo))
        {
            return "Only links on the standard ports, without a user name, have previews.";
        }

        var host = uri.IdnHost.TrimEnd('.');
        if (host is "localhost" || host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase)
            || host.EndsWith(".local", StringComparison.OrdinalIgnoreCase) || host.EndsWith(".internal", StringComparison.OrdinalIgnoreCase)
            || !host.Contains('.', StringComparison.Ordinal) && !host.Contains(':', StringComparison.Ordinal)
            || IPAddress.TryParse(host.Trim('[', ']'), out var literal) && !NetworkGuard.IsPublic(literal))
        {
            return "Links to private or local addresses have no previews.";
        }

        return null;
    }

    private async Task<LinkPreviewResponse?> FetchAsync(Uri uri, CancellationToken cancellationToken)
    {
        var client = http.CreateClient(ClientName);
        for (var hop = 0; hop <= MaxRedirects; hop++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/html"));
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if ((int)response.StatusCode is >= 300 and < 400 && response.Headers.Location is { } location)
            {
                var next = new Uri(uri, location);
                if (Validate(next.AbsoluteUri) is not null)
                {
                    return null;
                }

                uri = next;
                continue;
            }

            var type = response.Content.Headers.ContentType?.MediaType;
            if (!response.IsSuccessStatusCode || type is not ("text/html" or "application/xhtml+xml"))
            {
                return null;
            }

            await using var body = await response.Content.ReadAsStreamAsync(cancellationToken);
            var buffer = new byte[MaxBytes];
            var read = 0;
            while (read < buffer.Length && await body.ReadAsync(buffer.AsMemory(read), cancellationToken) is var count and > 0)
            {
                read += count;
            }

            var encoding = Encoding.UTF8;
            if (response.Content.Headers.ContentType?.CharSet is { } charset)
            {
                try
                {
                    encoding = Encoding.GetEncoding(charset.Trim('"'));
                }
                catch (ArgumentException)
                {
                    // unknown charset: read it as UTF-8
                }
            }

            return LinkPreviewParser.Parse(encoding.GetString(buffer, 0, read), uri);
        }

        return null;
    }
}
