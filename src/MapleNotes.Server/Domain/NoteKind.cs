namespace MapleNotes.Server.Domain;

/// <summary>
/// What a note is for, which decides where the app shows it. Stored in plain form in every encryption mode, like the
/// pinned and archived flags; the text itself is protected as usual.
/// </summary>
public enum NoteKind
{
    /// <summary>A note in the Home timeline.</summary>
    Note = 0,

    /// <summary>A todo list: a title and <c>- [ ]</c> items, shown in the Todo tab.</summary>
    Todo = 1,

    /// <summary>A quick note, kept out of the timeline in the Quick notes tab.</summary>
    Quick = 2,
}
