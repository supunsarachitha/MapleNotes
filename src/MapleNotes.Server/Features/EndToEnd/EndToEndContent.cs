using System.Globalization;

namespace MapleNotes.Server.Features.EndToEnd;

/// <summary>
/// Shape checks for content the browser encrypted (docs/e2ee-spec.md §2, §4). The server cannot look inside, so it
/// checks sizes and headers and that every item is bound to an ID the browser chose.
/// </summary>
public static class EndToEndContent
{
    /// <summary>Envelope header, nonce and tag: the bytes an envelope adds to its plaintext.</summary>
    public const int EnvelopeOverhead = 30;

    /// <summary>Largest note envelope: 100,000 characters of at most 4 UTF-8 bytes each, plus the overhead.</summary>
    public const int MaxNoteEnvelopeBytes = EnvelopeOverhead + (Notes.NoteService.MaxContentLength * 4);

    /// <summary>Largest encrypted tag name: 64 characters of at most 4 UTF-8 bytes each, plus the overhead.</summary>
    public const int MaxTagNameEnvelopeBytes = EnvelopeOverhead + (64 * 4);

    /// <summary>Most tags one note may carry.</summary>
    public const int MaxTagsPerNote = 100;

    /// <summary>How far a client-chosen ID's timestamp may be from the server's clock.</summary>
    public static readonly TimeSpan ClientIdTolerance = TimeSpan.FromHours(24);

    /// <summary>Returns true when <paramref name="envelope"/> looks like an envelope of at most <paramref name="maxBytes"/>.</summary>
    /// <param name="envelope">The bytes to check.</param>
    /// <param name="maxBytes">Largest acceptable size.</param>
    /// <returns>Whether it has the envelope header (format 1, key version at least 1) and a plausible size.</returns>
    public static bool IsEnvelope(byte[]? envelope, int maxBytes) =>
        envelope is { Length: >= EnvelopeOverhead } && envelope.Length <= maxBytes && envelope[0] == 1 && envelope[1] >= 1;

    /// <summary>Returns true for a tag token: 22 base64url characters (16 bytes).</summary>
    /// <param name="token">The token.</param>
    /// <returns>Whether it is well-formed.</returns>
    public static bool IsTagToken(string? token) =>
        token is { Length: 22 } && token.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');

    /// <summary>
    /// Checks an ID chosen by the browser for an end-to-end item, which binds its ciphertext: a UUID version 7 (RFC
    /// 9562) whose timestamp is within <see cref="ClientIdTolerance"/> of <paramref name="nowUtc"/>.
    /// </summary>
    /// <param name="id">The ID.</param>
    /// <param name="nowUtc">The server's clock.</param>
    /// <returns>An error message, or null when the ID is acceptable.</returns>
    public static string? ValidateClientId(Guid? id, DateTime nowUtc)
    {
        if (id is not { } value || value.Version != 7 || (value.Variant & 0b1100) != 0b1000)
        {
            return "End-to-end encrypted items need an ID chosen by the app: a UUID version 7.";
        }

        var milliseconds = long.Parse(value.ToString("N").AsSpan(0, 12), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        var created = DateTimeOffset.FromUnixTimeMilliseconds(milliseconds).UtcDateTime;
        return (created - nowUtc).Duration() > ClientIdTolerance
            ? "The ID's timestamp is too far from the server's clock. Check the device's date and time."
            : null;
    }
}
