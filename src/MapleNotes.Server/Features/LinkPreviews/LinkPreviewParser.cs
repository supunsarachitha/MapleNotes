using System.Net;
using System.Text.RegularExpressions;

namespace MapleNotes.Server.Features.LinkPreviews;

/// <summary>Reads a page's title, description and site name from its HTML (Open Graph tags first, then the basics).</summary>
public static partial class LinkPreviewParser
{
    private const int MaxTitle = 300;
    private const int MaxDescription = 500;

    /// <summary>The most of a page that is parsed: previews come from the head, which is near the start.</summary>
    private const int MaxParsed = 64 * 1024;

    /// <summary>Longer meta tags are skipped; real ones are a few hundred characters.</summary>
    private const int MaxMetaTag = 4096;

    /// <summary>Reads the preview of a page.</summary>
    /// <param name="html">The start of the page's HTML.</param>
    /// <param name="url">The page's address (for the site name when the page gives none).</param>
    /// <returns>The preview, or null when the page has no title.</returns>
    /// <remarks>
    /// The page is untrusted, so parsing is bounded: only its head (at most <see cref="MaxParsed"/> characters) is read,
    /// and every pattern runs on the non-backtracking engine, in time linear in its input.
    /// </remarks>
    public static LinkPreviewResponse? Parse(string html, Uri url)
    {
        html = html.Length > MaxParsed ? html[..MaxParsed] : html;
        var headEnd = html.IndexOf("</head", StringComparison.OrdinalIgnoreCase);
        html = headEnd >= 0 ? html[..headEnd] : html;
        var meta = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match tag in MetaTag().Matches(html))
        {
            if (tag.Length > MaxMetaTag)
            {
                continue;
            }

            var attributes = Attributes(tag.Value);
            var key = attributes.GetValueOrDefault("property") ?? attributes.GetValueOrDefault("name");
            if (key is not null && attributes.GetValueOrDefault("content") is { } content)
            {
                meta.TryAdd(key, content);
            }
        }

        var title = Clean(meta.GetValueOrDefault("og:title") ?? meta.GetValueOrDefault("twitter:title")
            ?? (TitleTag().Match(html) is { Success: true } t ? t.Groups[1].Value : null), MaxTitle);
        if (title is null)
        {
            return null;
        }

        var description = Clean(meta.GetValueOrDefault("og:description") ?? meta.GetValueOrDefault("twitter:description")
            ?? meta.GetValueOrDefault("description"), MaxDescription);
        var site = Clean(meta.GetValueOrDefault("og:site_name"), MaxTitle) ?? url.Host;
        return new LinkPreviewResponse(url.AbsoluteUri, title, description, site);
    }

    private static Dictionary<string, string> Attributes(string tag)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match attribute in Attribute().Matches(tag))
        {
            var value = attribute.Groups[2].Success ? attribute.Groups[2].Value : attribute.Groups[3].Success ? attribute.Groups[3].Value : attribute.Groups[4].Value;
            result.TryAdd(attribute.Groups[1].Value, value);
        }

        return result;
    }

    private static string? Clean(string? value, int max)
    {
        if (value is null)
        {
            return null;
        }

        var text = Whitespace().Replace(WebUtility.HtmlDecode(value), " ").Trim();
        return text.Length == 0 ? null : text.Length <= max ? text : text[..(max - 1)].TrimEnd() + "…";
    }

    [GeneratedRegex(@"<meta\b[^>]*>", RegexOptions.IgnoreCase | RegexOptions.NonBacktracking)]
    private static partial Regex MetaTag();

    [GeneratedRegex(@"<title\b[^>]*>(.*?)</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline | RegexOptions.NonBacktracking)]
    private static partial Regex TitleTag();

    [GeneratedRegex(@"([\w:-]+)\s*=\s*(?:""([^""]*)""|'([^']*)'|([^\s>""']+))", RegexOptions.NonBacktracking)]
    private static partial Regex Attribute();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();
}
