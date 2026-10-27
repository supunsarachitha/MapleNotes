namespace MapleNotes.Server.Domain;

/// <summary>
/// How a note's writer felt, chosen as one of five smilies on a note or quick note. Stored as an integer and written by
/// name in exports (<c>awful</c> … <c>great</c>), the format Falcon Notes 1.7.0 defined, so the numbers and the names
/// never change; a new mood takes the next number.
/// </summary>
public enum NoteMood
{
    /// <summary>No mood chosen: the default, and every note written before moods.</summary>
    None = 0,

    /// <summary>The worst of the five.</summary>
    Awful = 1,

    /// <summary>Not good.</summary>
    Bad = 2,

    /// <summary>Neither good nor bad.</summary>
    Okay = 3,

    /// <summary>Good.</summary>
    Good = 4,

    /// <summary>The best of the five.</summary>
    Great = 5,
}

/// <summary>The rules of moods: which notes can have one, and how they are named in exports.</summary>
public static class NoteMoods
{
    /// <summary>The moods to choose from, worst to best.</summary>
    public static readonly IReadOnlyList<NoteMood> All = [NoteMood.Awful, NoteMood.Bad, NoteMood.Okay, NoteMood.Good, NoteMood.Great];

    /// <summary>
    /// Whether a note of this kind can have a mood: timeline notes and quick notes, which are written like a diary. A
    /// todo list and a habit cannot.
    /// </summary>
    /// <param name="kind">The kind.</param>
    /// <returns>Whether it can.</returns>
    public static bool Allowed(NoteKind kind) => kind is NoteKind.Note or NoteKind.Quick;

    /// <summary>The mood as exports write it: <c>awful</c>, <c>bad</c>, <c>okay</c>, <c>good</c> or <c>great</c>.</summary>
    /// <param name="mood">The mood.</param>
    /// <returns>Its name, or null for none, which exports leave out.</returns>
    public static string? Name(NoteMood mood) => mood == NoteMood.None || !Enum.IsDefined(mood) ? null : mood.ToString().ToLowerInvariant();
}
