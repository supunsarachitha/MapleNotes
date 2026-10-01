namespace MapleNotes.Server.Domain;

/// <summary>A coloured label that its owner puts on notes by hand, unlike tags, which come from the text.</summary>
/// <remarks>
/// A label of an account without end-to-end encryption has a <see cref="Name"/>. A label of an end-to-end account has no
/// readable name: only <see cref="EncryptedName"/>, encrypted by the browser and bound to the label's ID
/// (docs/e2ee-spec.md §4a). The colour is a layout choice and stays readable, like the account's preferences.
/// </remarks>
public sealed class Label
{
    /// <summary>The colours a label can have.</summary>
    public static IReadOnlyList<string> Colors { get; } = ["Grey", "Red", "Orange", "Amber", "Green", "Teal", "Blue", "Indigo", "Purple", "Pink"];

    /// <summary>Longest name, in characters.</summary>
    public const int MaxNameLength = 40;

    /// <summary>Most labels one account may have.</summary>
    public const int MaxPerAccount = 100;

    /// <summary>Most labels one note may carry.</summary>
    public const int MaxPerNote = 20;

    /// <summary>Primary key (UUID version 7); chosen by the browser for an end-to-end label.</summary>
    public Guid Id { get; init; } = Guid.CreateVersion7();

    /// <summary>The owner. Labels are private to each user.</summary>
    public Guid UserId { get; init; }

    /// <summary>The name as the owner wrote it; null for an end-to-end label.</summary>
    public string? Name { get; set; }

    /// <summary>The name of an end-to-end label, encrypted by the browser.</summary>
    public byte[]? EncryptedName { get; set; }

    /// <summary>One of <see cref="Colors"/>.</summary>
    public string Color { get; set; } = "Grey";

    /// <summary>When the label was created (UTC).</summary>
    public DateTime CreatedAtUtc { get; init; }
}
