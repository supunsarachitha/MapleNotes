namespace MapleNotes.Server.Domain;

/// <summary>A note (memo): a short Markdown text with optional attachments and tags.</summary>
public sealed class Note : IRevisioned
{
    /// <summary>Primary key (UUID version 7).</summary>
    public Guid Id { get; init; } = Guid.CreateVersion7();

    /// <summary>The owner.</summary>
    public Guid UserId { get; init; }

    /// <summary>
    /// The Markdown body: UTF-8 bytes when <see cref="IsEncrypted"/> is false, otherwise an AES-256-GCM envelope
    /// produced with the owner's data key.
    /// </summary>
    public byte[] Content { get; set; } = [];

    /// <summary>Whether <see cref="Content"/> is encrypted.</summary>
    public bool IsEncrypted { get; set; }

    /// <summary>Pinned notes are listed above the feed.</summary>
    public bool IsPinned { get; set; }

    /// <summary>When the note was archived (UTC); null for active notes. Archiving is a reversible soft delete.</summary>
    public DateTime? ArchivedAtUtc { get; set; }

    /// <summary>When the note was created (UTC). The feed is ordered by this value, newest first.</summary>
    public DateTime CreatedAtUtc { get; set; }

    /// <summary>When the note was last edited (UTC).</summary>
    public DateTime UpdatedAtUtc { get; set; }

    /// <inheritdoc />
    public int Revision { get; set; }

    /// <summary>Files attached to the note.</summary>
    public List<Attachment> Attachments { get; init; } = [];

    /// <summary>Tags found in the note body (<c>#tag</c>).</summary>
    public List<Tag> Tags { get; init; } = [];
}
