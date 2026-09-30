namespace MapleNotes.Server.Domain;

/// <summary>
/// An account's writing and feature preferences, shared by all of its devices. They are layout choices, not content,
/// so they are stored in plain form in every encryption mode (docs/threat-model.md).
/// </summary>
public sealed record UserPreferences
{
    /// <summary>The date formats a user can choose, as .NET-style patterns; the web app formats dates with them.</summary>
    public static IReadOnlyList<string> DateFormats { get; } =
    [
        "yyyy-MM-dd",
        "dd/MM/yyyy",
        "MM/dd/yyyy",
        "dd.MM.yyyy",
        "d MMM yyyy",
        "MMM d, yyyy",
        "dddd, d MMMM yyyy",
        "dddd, MMMM d, yyyy",
    ];

    /// <summary>Light or dark: follow the device (<c>System</c>), or always <c>Light</c> or <c>Dark</c>.</summary>
    public static IReadOnlyList<string> Themes { get; } = ["System", "Light", "Dark"];

    /// <summary>The accent colours a user can choose.</summary>
    public static IReadOnlyList<string> Accents { get; } = ["Maple", "Ocean", "Forest", "Teal", "Plum", "Amber", "Slate"];

    /// <summary>
    /// Show a title field when writing notes. A title is stored as the note's first line, written as a Markdown
    /// heading, so turning this off never changes a note.
    /// </summary>
    public bool NoteTitles { get; init; }

    /// <summary>With titles on, start the title of a new note with today's date.</summary>
    public bool DateInTitles { get; init; }

    /// <summary>How dates are written in titles and daily notes: one of <see cref="DateFormats"/>.</summary>
    public string DateFormat { get; init; } = "yyyy-MM-dd";

    /// <summary>Show the Todo tab. Turning it off hides the tab but keeps the lists.</summary>
    public bool TodoLists { get; init; } = true;

    /// <summary>Show the Quick notes tab. Turning it off hides the tab but keeps the notes.</summary>
    public bool QuickNotes { get; init; } = true;

    /// <summary>Show today's daily note at the top of Home.</summary>
    public bool DailyNotes { get; init; }

    /// <summary>Show a month calendar in the side menu for finding notes by date.</summary>
    public bool Calendar { get; init; } = true;

    /// <summary>
    /// Show the Habits tab, for ticking off daily habits and seeing progress in a chart. Turning it off hides the tab
    /// but keeps the habits; off by default.
    /// </summary>
    public bool HabitTracker { get; init; }

    /// <summary>
    /// Show previews of links in notes. The server then fetches the linked pages, so it learns those links, also for
    /// end-to-end accounts; off by default.
    /// </summary>
    public bool LinkPreviews { get; init; }

    /// <summary>Light or dark: one of <see cref="Themes"/>.</summary>
    public string Theme { get; init; } = "System";

    /// <summary>The interface's accent colour: one of <see cref="Accents"/>.</summary>
    public string Accent { get; init; } = "Maple";
}
