using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Net.Http.Headers;

namespace MapleNotes.Server.Features.Attachments;

/// <summary>
/// Rules for accepting and serving uploaded files safely.
/// </summary>
/// <remarks>
/// Uploaded files are untrusted. Only media types that browsers display passively (images, audio, video, plain text)
/// are ever served inline; everything else, including SVG and HTML, which can carry scripts, is served as a download
/// with a generic content type. Every attachment response also carries <c>X-Content-Type-Options: nosniff</c> and a
/// sandboxing Content-Security-Policy.
/// </remarks>
public static class UploadPolicy
{
    /// <summary>Content type used for files that must only be downloaded.</summary>
    public const string DownloadContentType = "application/octet-stream";

    private const int MaxFileNameLength = 200;

    private static readonly FileExtensionContentTypeProvider ContentTypesByExtension = new();

    private static readonly HashSet<string> InlineContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp",
        "video/mp4", "video/webm",
        "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm", "audio/flac",
        "text/plain",
    };

    /// <summary>
    /// Returns a safe file name: no directories, control characters, reserved characters or the invisible characters
    /// that reorder text (which can disguise <c>invoice‮fdp.exe</c> as <c>invoiceexe.pdf</c>), at most 200 characters,
    /// never empty.
    /// </summary>
    /// <param name="fileName">The name supplied by the client.</param>
    /// <returns>The sanitized name.</returns>
    public static string SanitizeFileName(string? fileName)
    {
        static bool IsBidiControlOrSeparator(char c) =>
            c is '\u061C' or '\u200E' or '\u200F' or (>= '\u202A' and <= '\u202E') or (>= '\u2066' and <= '\u2069') or '\u2028' or '\u2029';

        var name = Path.GetFileName((fileName ?? string.Empty).Replace('\\', '/'));
        name = new string(name.Where(c => !char.IsControl(c) && !IsBidiControlOrSeparator(c)
            && c is not ('"' or '<' or '>' or '|' or ':' or '*' or '?' or '/')).ToArray());
        name = name.Trim().Trim('.').Trim();
        if (name.Length == 0)
        {
            return "file";
        }

        if (name.Length > MaxFileNameLength)
        {
            var extension = Path.GetExtension(name);
            extension = extension.Length <= 20 ? extension : string.Empty;
            name = name[..(MaxFileNameLength - extension.Length)] + extension;
        }

        return name;
    }

    /// <summary>
    /// Determines the content type to record for an upload: the client's declared type if it is meaningful,
    /// otherwise a guess from the file extension.
    /// </summary>
    /// <param name="declared">The Content-Type of the uploaded part, if any.</param>
    /// <param name="fileName">The sanitized file name.</param>
    /// <returns>A lower-case media type without parameters.</returns>
    public static string ResolveContentType(string? declared, string fileName)
    {
        if (MediaTypeHeaderValue.TryParse(declared, out var parsed)
            && parsed.MediaType.HasValue
            && !parsed.MediaType.Equals(DownloadContentType, StringComparison.OrdinalIgnoreCase)
            && parsed.MediaType.Value!.Length <= 100)
        {
            return parsed.MediaType.Value.ToLowerInvariant();
        }

        return ContentTypesByExtension.TryGetContentType(fileName, out var guessed) ? guessed : DownloadContentType;
    }

    /// <summary>Whether a file of this type may be displayed in the browser rather than downloaded.</summary>
    /// <param name="contentType">The recorded content type.</param>
    /// <returns>True for passive media types.</returns>
    public static bool CanDisplayInline(string contentType) => InlineContentTypes.Contains(contentType);

    /// <summary>Whether the file is an image the app can show as a thumbnail.</summary>
    /// <param name="contentType">The recorded content type.</param>
    /// <returns>True for inline-safe image types.</returns>
    public static bool IsImage(string contentType) =>
        contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) && CanDisplayInline(contentType);
}
