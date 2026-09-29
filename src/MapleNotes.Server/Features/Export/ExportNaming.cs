using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace MapleNotes.Server.Features.Export;

/// <summary>
/// File and folder names for exports, safe on Windows, macOS and Linux: no reserved characters or device names, no
/// leading or trailing dots and spaces, bounded length, and unique within the archive (compared case-insensitively,
/// as on Windows and macOS).
/// </summary>
public static partial class ExportNaming
{
    private const int MaxSlugLength = 60;
    private const int MaxAttachmentNameLength = 100;

    private static readonly HashSet<string> ReservedWindowsNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    };

    /// <summary>
    /// Turns the first line of a note into a short, lower-case file-name slug ("Buy **maple** syrup! #shopping"
    /// becomes "buy-maple-syrup"). Letters in any script are kept; #tags are left out unless the line has nothing else.
    /// </summary>
    /// <param name="markdown">The note text.</param>
    /// <returns>The slug, or <c>note</c> when the text has no usable characters.</returns>
    public static string Slug(string markdown)
    {
        var firstLine = markdown.Split('\n').Select(line => line.Trim()).FirstOrDefault(line => line.Length > 0) ?? string.Empty;
        firstLine = LineMarkers().Replace(firstLine, string.Empty);
        var withoutTags = Tags().Replace(firstLine, " ");
        if (withoutTags.Any(char.IsLetterOrDigit))
        {
            firstLine = withoutTags;
        }

        var slug = new StringBuilder(MaxSlugLength);
        var pendingDash = false;
        foreach (var rune in firstLine.EnumerateRunes())
        {
            if (Rune.IsLetterOrDigit(rune))
            {
                var letter = Rune.ToLowerInvariant(rune).ToString();
                var dash = pendingDash && slug.Length > 0;
                if (slug.Length + letter.Length + (dash ? 1 : 0) > MaxSlugLength)
                {
                    break; // never cut a word's character (or a surrogate pair) in half
                }

                if (dash)
                {
                    slug.Append('-');
                }

                pendingDash = false;
                slug.Append(letter);
            }
            else if (rune.Value is not ('\'' or '’'))
            {
                pendingDash = true; // any other character separates words
            }
        }

        var result = slug.ToString().Trim('-');
        return result.Length == 0 ? "note" : result;
    }

    /// <summary>Makes an uploaded file name safe to write into an archive.</summary>
    /// <param name="fileName">The attachment's file name.</param>
    /// <returns>A safe name with the extension kept.</returns>
    public static string SafeFileName(string fileName)
    {
        var cleaned = new StringBuilder(fileName.Length);
        foreach (var c in fileName)
        {
            cleaned.Append(char.IsControl(c) || char.IsWhiteSpace(c) || c is '\\' or '/' or ':' or '*' or '?' or '"' or '<' or '>' or '|' ? '-' : c);
        }

        var name = DashRuns().Replace(cleaned.ToString(), "-").Trim('.', ' ', '-');
        if (name.Length == 0)
        {
            name = "file";
        }

        var extension = Path.GetExtension(name);
        var stem = name[..^extension.Length];
        if (stem.Length == 0 || ReservedWindowsNames.Contains(stem))
        {
            stem = "_" + stem;
        }

        if (extension.Length > 20)
        {
            extension = string.Empty;
        }

        if (stem.Length + extension.Length > MaxAttachmentNameLength)
        {
            stem = stem[..(MaxAttachmentNameLength - extension.Length)];
        }

        return stem + extension;
    }

    /// <summary>Returns the folder (without trailing slash) for a note created at <paramref name="created"/>.</summary>
    /// <param name="layout">The layout.</param>
    /// <param name="created">Creation time in the export's time zone.</param>
    /// <returns>The folder, or an empty string for <see cref="ExportLayout.Flat"/>.</returns>
    public static string Folder(ExportLayout layout, DateTimeOffset created) => layout switch
    {
        ExportLayout.Year => created.ToString("yyyy", CultureInfo.InvariantCulture),
        ExportLayout.Month => created.ToString("yyyy-MM", CultureInfo.InvariantCulture),
        ExportLayout.Day => created.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        _ => string.Empty,
    };

    /// <summary>
    /// Returns <paramref name="path"/>, or the first free variant with a <c>-2</c>, <c>-3</c>… suffix before the
    /// extension, and records it as used.
    /// </summary>
    /// <param name="path">The desired archive path.</param>
    /// <param name="used">Paths already in the archive (case-insensitive).</param>
    /// <returns>A path not yet in <paramref name="used"/>.</returns>
    public static string Unique(string path, ISet<string> used)
    {
        var candidate = path;
        var extension = Path.GetExtension(path);
        var stem = path[..^extension.Length];
        for (var n = 2; !used.Add(candidate); n++)
        {
            candidate = $"{stem}-{n}{extension}";
        }

        return candidate;
    }

    /// <summary>Path from the folder of <paramref name="fromFile"/> to <paramref name="toPath"/>, e.g. <c>../attachments/x.png</c>.</summary>
    /// <param name="fromFile">Archive path of the referencing file.</param>
    /// <param name="toPath">Archive path of the referenced file.</param>
    /// <returns>The relative path.</returns>
    public static string RelativePath(string fromFile, string toPath)
    {
        var depth = fromFile.Count(c => c == '/');
        return string.Concat(Enumerable.Repeat("../", depth)) + toPath;
    }

    /// <summary>Percent-encodes a relative path for use as a Markdown link target, keeping the slashes.</summary>
    /// <param name="relativePath">A path such as <c>../attachments/café menu.pdf</c>.</param>
    /// <returns>The encoded link target.</returns>
    public static string LinkTarget(string relativePath) =>
        string.Join('/', relativePath.Split('/').Select(segment => segment == ".." ? segment : Uri.EscapeDataString(segment)));

    /// <summary>Heading markers, quote markers, list bullets and task boxes at the start of a line.</summary>
    [GeneratedRegex(@"^(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)+", RegexOptions.CultureInvariant)]
    private static partial Regex LineMarkers();

    [GeneratedRegex("-{2,}", RegexOptions.CultureInvariant)]
    private static partial Regex DashRuns();

    /// <summary>#tags, as recognized by the note tag parser.</summary>
    [GeneratedRegex(@"(?<![\p{L}\p{N}_/#&])#[\p{L}\p{N}_][\p{L}\p{N}_/-]*", RegexOptions.CultureInvariant)]
    private static partial Regex Tags();
}
