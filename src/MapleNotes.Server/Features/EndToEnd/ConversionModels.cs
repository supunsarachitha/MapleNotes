using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Notes;

namespace MapleNotes.Server.Features.EndToEnd;

/// <summary>A note the browser has to convert.</summary>
/// <param name="Id">Note ID.</param>
/// <param name="Content">Entering end-to-end mode: the plain text to encrypt.</param>
/// <param name="EncryptedContent">Leaving end-to-end mode: the envelope to decrypt.</param>
/// <param name="UpdatedAtUtc">Send back unchanged: the conversion fails if the note was edited meanwhile.</param>
public sealed record ConversionNote(Guid Id, string? Content, byte[]? EncryptedContent, DateTime UpdatedAtUtc);

/// <summary>A file the browser has to convert; its content comes from <c>GET /api/v1/attachments/{id}</c>.</summary>
/// <param name="Id">Attachment ID.</param>
/// <param name="FileName">Entering end-to-end mode: the name to encrypt.</param>
/// <param name="ContentType">Entering end-to-end mode: the type to encrypt.</param>
/// <param name="SizeBytes">Size as stored.</param>
/// <param name="EncryptedMetadata">Leaving end-to-end mode: the metadata to decrypt.</param>
public sealed record ConversionAttachment(Guid Id, string? FileName, string? ContentType, long SizeBytes, byte[]? EncryptedMetadata);

/// <summary>The next items the browser has to convert after a change to or from end-to-end encryption.</summary>
/// <param name="Mode">The account's mode: end-to-end means encrypting, anything else decrypting.</param>
/// <param name="Remaining">Items still to convert, including this batch.</param>
/// <param name="Notes">Notes of this batch, oldest first.</param>
/// <param name="Attachments">Files of this batch, oldest first, after the notes.</param>
public sealed record ConversionBatchResponse(
    EncryptionMode Mode, int Remaining, IReadOnlyList<ConversionNote> Notes, IReadOnlyList<ConversionAttachment> Attachments);

/// <summary>A converted note.</summary>
/// <param name="UpdatedAtUtc">The value from the batch; a different current value means the note was edited.</param>
/// <param name="Content">Leaving end-to-end mode: the decrypted text.</param>
/// <param name="Encrypted">Entering end-to-end mode: the encrypted text and tags.</param>
public sealed record ConvertNoteRequest(DateTime UpdatedAtUtc, string? Content = null, EncryptedNote? Encrypted = null);
