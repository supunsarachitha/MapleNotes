using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Notes;

namespace MapleNotes.Server.Features.EndToEnd;

/// <summary>A note the browser has to convert.</summary>
/// <param name="Id">Note ID.</param>
/// <param name="Content">Entering end-to-end mode: the plain text to encrypt.</param>
/// <param name="EncryptedContent">Leaving end-to-end mode: the envelope to decrypt.</param>
/// <param name="UpdatedAtUtc">Send back unchanged: the conversion fails if the note was edited meanwhile.</param>
/// <param name="Mood">Entering end-to-end mode: the mood to encrypt; null for none.</param>
/// <param name="EncryptedMood">Leaving end-to-end mode: the encrypted mood to decrypt, if the note has one.</param>
public sealed record ConversionNote(
    Guid Id, string? Content, byte[]? EncryptedContent, DateTime UpdatedAtUtc, NoteMood? Mood = null, byte[]? EncryptedMood = null);

/// <summary>A file the browser has to convert; its content comes from <c>GET /api/v1/attachments/{id}</c>.</summary>
/// <param name="Id">Attachment ID.</param>
/// <param name="FileName">Entering end-to-end mode: the name to encrypt.</param>
/// <param name="ContentType">Entering end-to-end mode: the type to encrypt.</param>
/// <param name="SizeBytes">Size as stored.</param>
/// <param name="EncryptedMetadata">Leaving end-to-end mode: the metadata to decrypt.</param>
/// <param name="IsSticker">Entering end-to-end mode: whether the file is a sticker, to encrypt with its metadata.</param>
public sealed record ConversionAttachment(
    Guid Id, string? FileName, string? ContentType, long SizeBytes, byte[]? EncryptedMetadata, bool IsSticker = false);

/// <summary>
/// A label whose name the browser has to convert: it saves the name again in the new form with
/// <c>PUT /api/v1/labels/{id}</c>.
/// </summary>
/// <param name="Id">Label ID.</param>
/// <param name="Name">Entering end-to-end mode: the name to encrypt.</param>
/// <param name="EncryptedName">Leaving end-to-end mode: the encrypted name to decrypt.</param>
public sealed record ConversionLabel(Guid Id, string? Name, byte[]? EncryptedName);

/// <summary>The next items the browser has to convert after a change to or from end-to-end encryption.</summary>
/// <param name="Mode">The account's mode: end-to-end means encrypting, anything else decrypting.</param>
/// <param name="Remaining">Items still to convert, including this batch.</param>
/// <param name="Notes">Notes of this batch, oldest first.</param>
/// <param name="Attachments">Files of this batch, oldest first, after the notes.</param>
/// <param name="Labels">Labels of this batch, after the files.</param>
public sealed record ConversionBatchResponse(
    EncryptionMode Mode,
    int Remaining,
    IReadOnlyList<ConversionNote> Notes,
    IReadOnlyList<ConversionAttachment> Attachments,
    IReadOnlyList<ConversionLabel>? Labels = null);

/// <summary>A converted note.</summary>
/// <param name="UpdatedAtUtc">The value from the batch; a different current value means the note was edited.</param>
/// <param name="Content">Leaving end-to-end mode: the decrypted text.</param>
/// <param name="Encrypted">Entering end-to-end mode: the encrypted text, tags and mood.</param>
/// <param name="Mood">Leaving end-to-end mode: the decrypted mood; omit for none.</param>
public sealed record ConvertNoteRequest(DateTime UpdatedAtUtc, string? Content = null, EncryptedNote? Encrypted = null, NoteMood? Mood = null);
