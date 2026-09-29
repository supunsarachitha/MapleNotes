namespace MapleNotes.Server.Domain;

/// <summary>A tag used by one user, derived from <c>#tag</c> words in their notes.</summary>
/// <remarks>
/// A tag of plain-text notes has a <see cref="Name"/>. A tag of end-to-end encrypted notes has no readable name: only a
/// blind <see cref="Token"/> (an HMAC of the name under a key derived from the user's end-to-end key) and the name
/// encrypted by the browser (docs/e2ee-spec.md §4). The server can group and count notes by tag without learning what
/// the tag says.
/// </remarks>
public sealed class Tag
{
    /// <summary>Primary key (UUID version 7).</summary>
    public Guid Id { get; init; } = Guid.CreateVersion7();

    /// <summary>The owner. Tags are private to each user.</summary>
    public Guid UserId { get; init; }

    /// <summary>Lower-case tag text without the leading <c>#</c>, unique per user; null for an end-to-end tag.</summary>
    public string? Name { get; set; }

    /// <summary>The blind token of an end-to-end tag (22 base64url characters), unique per user.</summary>
    public string? Token { get; set; }

    /// <summary>The name of an end-to-end tag, encrypted by the browser.</summary>
    public byte[]? EncryptedName { get; set; }
}
