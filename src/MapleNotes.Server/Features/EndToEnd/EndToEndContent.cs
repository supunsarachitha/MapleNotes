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

    /// <summary>Largest encrypted attachment metadata: a small JSON object with a file name of at most 255 characters.</summary>
    public const int MaxMetadataEnvelopeBytes = EnvelopeOverhead + 2048;

    /// <summary>Size of the header of an encrypted attachment (docs/e2ee-spec.md §5).</summary>
    public const int AttachmentHeaderBytes = 42;

    /// <summary>Plaintext bytes per chunk of an encrypted attachment.</summary>
    public const int AttachmentChunkBytes = 64 * 1024;

    private const int AttachmentTagBytes = 16;

    /// <summary>How far a client-chosen ID's timestamp may be from the server's clock.</summary>
    public static readonly TimeSpan ClientIdTolerance = TimeSpan.FromHours(24);

    /// <summary>Returns true when <paramref name="envelope"/> looks like an envelope of at most <paramref name="maxBytes"/>.</summary>
    /// <param name="envelope">The bytes to check.</param>
    /// <param name="maxBytes">Largest acceptable size.</param>
    /// <returns>Whether it has the envelope header (format 1, key version at least 1) and a plausible size.</returns>
    public static bool IsEnvelope(byte[]? envelope, int maxBytes) =>
        envelope is { Length: >= EnvelopeOverhead } && envelope.Length <= maxBytes && envelope[0] == 1 && envelope[1] >= 1;

    /// <summary>
    /// Returns true when <paramref name="header"/> starts an encrypted attachment: magic <c>MNAE</c>, format 1, a key
    /// version of at least 1 and 64 KiB chunks.
    /// </summary>
    /// <param name="header">The first <see cref="AttachmentHeaderBytes"/> bytes of the upload.</param>
    /// <returns>Whether the header is acceptable.</returns>
    public static bool IsAttachmentHeader(ReadOnlySpan<byte> header) =>
        header.Length >= AttachmentHeaderBytes
        && header[..4].SequenceEqual("MNAE"u8)
        && header[4] == 1
        && header[5] >= 1
        && System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(header[6..10]) == AttachmentChunkBytes;

    /// <summary>Returns true when an encrypted attachment of this total size has a complete last chunk.</summary>
    /// <param name="size">Size of the whole encrypted file, header included.</param>
    /// <returns>Whether every chunk, the last one included, holds at least its authentication tag.</returns>
    public static bool IsAttachmentSize(long size)
    {
        var body = size - AttachmentHeaderBytes;
        var remainder = body % (AttachmentChunkBytes + AttachmentTagBytes);
        return body >= AttachmentTagBytes && (remainder == 0 || remainder >= AttachmentTagBytes);
    }

    /// <summary>The largest encrypted size of a file of at most <paramref name="plainBytes"/> bytes.</summary>
    /// <param name="plainBytes">The plaintext size limit.</param>
    /// <returns>That size plus the header and one tag per chunk.</returns>
    public static long MaxAttachmentCiphertextBytes(long plainBytes) =>
        plainBytes + AttachmentHeaderBytes + (AttachmentTagBytes * Math.Max(1, (plainBytes + AttachmentChunkBytes - 1) / AttachmentChunkBytes));

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
        if (!IsVersion7(id))
        {
            return "End-to-end encrypted items need an ID chosen by the app: a UUID version 7.";
        }

        return (IdTime(id!.Value) - nowUtc).Duration() > ClientIdTolerance
            ? "The ID's timestamp is too far from the server's clock. Check the device's date and time."
            : null;
    }

    /// <summary>
    /// Checks the ID of an end-to-end note being restored from an export: a UUID version 7, which may be old (it keeps
    /// the note's original ID) but not in the future beyond <see cref="ClientIdTolerance"/>.
    /// </summary>
    /// <param name="id">The ID.</param>
    /// <param name="nowUtc">The server's clock.</param>
    /// <returns>An error message, or null when the ID is acceptable.</returns>
    public static string? ValidateImportedId(Guid? id, DateTime nowUtc) =>
        !IsVersion7(id) ? "End-to-end encrypted notes need a UUID version 7 as their ID."
        : IdTime(id!.Value) - nowUtc > ClientIdTolerance ? "The ID's timestamp is in the future."
        : null;

    private static bool IsVersion7(Guid? id) => id is { Version: 7 } value && (value.Variant & 0b1100) == 0b1000;

    private static DateTime IdTime(Guid id) =>
        DateTimeOffset.FromUnixTimeMilliseconds(long.Parse(id.ToString("N").AsSpan(0, 12), NumberStyles.HexNumber, CultureInfo.InvariantCulture)).UtcDateTime;
}
