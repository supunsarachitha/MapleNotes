using System.Text.RegularExpressions;

namespace MapleNotes.Server.Features.Notes;

/// <summary>
/// Finds <c>#tags</c> in note text. Tags are case-insensitive, may be nested with slashes (<c>#work/meetings</c>), and
/// are ignored inside code, Markdown headings, URL fragments and HTML entities.
/// </summary>
public static partial class TagParser
{
    /// <summary>Longest tag kept, in characters.</summary>
    public const int MaxTagLength = 64;

    /// <summary>Returns the distinct tags in <paramref name="markdown"/>, lower-cased, in order of appearance.</summary>
    /// <remarks>
    /// The patterns run with a time limit. Should a pathological note ever exceed it, the note simply gets no tags
    /// instead of tying up the server.
    /// </remarks>
    /// <param name="markdown">Note text.</param>
    /// <returns>Tag names without the leading <c>#</c>.</returns>
    public static IReadOnlyList<string> Extract(string markdown)
    {
        try
        {
            var withoutCode = CodePattern().Replace(markdown, " ");
            return TagPattern().Matches(withoutCode)
                .Select(match => match.Groups["tag"].Value.TrimEnd('/', '-').ToLowerInvariant())
                .Where(tag => tag.Length > 0 && !tag.All(char.IsAsciiDigit)) // "#1" is usually an issue number
                .Distinct(StringComparer.Ordinal)
                .ToList();
        }
        catch (RegexMatchTimeoutException)
        {
            return [];
        }
    }

    /// <summary>Fenced code blocks (closed or running to the end) and inline code spans.</summary>
    [GeneratedRegex(@"```[\s\S]*?(?:```|\z)|`[^`\n]*`", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex CodePattern();

    /// <summary>
    /// A <c>#</c> not preceded by a letter, digit, underscore, slash, <c>#</c> or <c>&amp;</c> (which would make it
    /// part of a word, URL, heading marker or HTML entity), followed by a letter, digit or underscore.
    /// </summary>
    [GeneratedRegex(@"(?<![\p{L}\p{N}_/#&])#(?<tag>[\p{L}\p{N}_][\p{L}\p{N}_/-]{0,63})", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 1000)]
    private static partial Regex TagPattern();
}
