namespace MapleNotes.Server.Domain;

/// <summary>A file (image or other document) uploaded by a user, optionally linked to a note.</summary>
public sealed class Attachment : IRevisioned
{
    /// <summary>Primary key (UUID version 7).</summary>
    public Guid Id { get; init; } = Guid.CreateVersion7();

    /// <summary>The owner.</summary>
    public Guid UserId { get; init; }

    /// <summary>
    /// The note the file belongs to. Null while the note is still being written; unlinked uploads are removed by a
    /// background cleanup after a grace period.
    /// </summary>
    public Guid? NoteId { get; set; }

    /// <summary>Original file name, sanitized.</summary>
    public required string FileName { get; set; }

    /// <summary>MIME type used when serving the file.</summary>
    public required string ContentType { get; set; }

    /// <summary>Size of the original (decrypted) content in bytes.</summary>
    public long SizeBytes { get; set; }

    /// <summary>Location of the file inside the attachment store (see <c>AttachmentStore</c>).</summary>
    public required string StorageKey { get; set; }

    /// <summary>How the stored file is protected.</summary>
    public ContentScheme Scheme { get; set; }

    /// <summary>
    /// For an end-to-end encrypted file: its name, type and size, encrypted by the browser (docs/e2ee-spec.md §5). The
    /// plain <see cref="FileName"/> and <see cref="ContentType"/> are then placeholders.
    /// </summary>
    public byte[]? EncryptedMetadata { get; set; }

    /// <summary>When the file was uploaded (UTC).</summary>
    public DateTime CreatedAtUtc { get; set; }

    /// <inheritdoc />
    public int Revision { get; set; }
}
