namespace MapleNotes.Server.Domain;

/// <summary>A tag used by one user, derived from <c>#tag</c> words in their notes.</summary>
public sealed class Tag
{
    /// <summary>Primary key (UUID version 7).</summary>
    public Guid Id { get; init; } = Guid.CreateVersion7();

    /// <summary>The owner. Tags are private to each user.</summary>
    public Guid UserId { get; init; }

    /// <summary>Lower-case tag text without the leading <c>#</c>; unique per user.</summary>
    public required string Name { get; set; }
}
