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

    /// <summary>The text sizes a user can choose for the side menu.</summary>
    public static IReadOnlyList<string> MenuTextSizes { get; } = ["Small", "Medium", "Large"];

    /// <summary>The first days of the week a user can choose; <c>Auto</c> follows the browser's language settings.</summary>
    public static IReadOnlyList<string> WeekStarts { get; } = ["Auto", "Sunday", "Monday", "Saturday"];

    /// <summary>The items of the side menu, in their default order; <see cref="MenuOrder"/> rearranges them.</summary>
    public static IReadOnlyList<string> MenuItems { get; } = ["home", "todo", "quick", "habits", "tags", "archive", "settings", "help"];

    /// <summary>
    /// Show a title field when writing notes. A title is stored as the note's first line, written as a Markdown
    /// heading, so turning this off never changes a note.
    /// </summary>
    public bool NoteTitles { get; init; }

    /// <summary>With titles on, start the title of a new note with today's date.</summary>
    public bool DateInTitles { get; init; }

    /// <summary>With titles on, give quick notes a title field too; off by default.</summary>
    public bool QuickNoteTitles { get; init; }

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
    /// Show the Archive page, and the Archive action on notes and todo lists. Turning it off hides them but keeps the
    /// archived notes; on by default.
    /// </summary>
    public bool Archive { get; init; } = true;

    /// <summary>Show the Tags page. Turning it off hides the page; tags in notes still work. On by default.</summary>
    public bool Tags { get; init; } = true;

    /// <summary>
    /// Shrink photos in the browser before they upload: at most 2560 pixels on their longest side, re-saved as JPEG.
    /// The original is not kept; off by default.
    /// </summary>
    public bool ShrinkPhotos { get; init; }

    /// <summary>
    /// Show previews of links in notes. The server then fetches the linked pages, so it learns those links, also for
    /// end-to-end accounts; off by default.
    /// </summary>
    public bool LinkPreviews { get; init; }

    /// <summary>Double-tap (or double-click) a note to edit it, as well as choosing Edit from its menu; off by default.</summary>
    public bool DoubleTapToEdit { get; init; }

    /// <summary>Suggest the account's existing tags while a <c>#tag</c> is being typed; off by default.</summary>
    public bool TagSuggestions { get; init; }

    /// <summary>
    /// Coloured labels: put labels on notes from their menu and list a label's notes. Turning it off hides them but keeps
    /// them; off by default.
    /// </summary>
    public bool Labels { get; init; }

    /// <summary>
    /// Deleting moves notes to the trash, where they can be restored for 30 days; on by default. Off, deleting is
    /// immediate and permanent.
    /// </summary>
    public bool Trash { get; init; } = true;

    /// <summary>Light or dark: one of <see cref="Themes"/>.</summary>
    public string Theme { get; init; } = "System";

    /// <summary>The interface's accent colour: one of <see cref="Accents"/>.</summary>
    public string Accent { get; init; } = "Maple";

    /// <summary>The side menu's text size: one of <see cref="MenuTextSizes"/>.</summary>
    public string MenuTextSize { get; init; } = "Medium";

    /// <summary>The first day of the week in the calendars and the weekly habit chart: one of <see cref="WeekStarts"/>.</summary>
    public string WeekStart { get; init; } = "Auto";

    /// <summary>
    /// The side menu's items in the order the user chose, separated by commas (<c>todo,home,help</c>): items of
    /// <see cref="MenuItems"/>, each at most once. Items left out follow in their default order, so an empty value (the
    /// default) is the default order. A string rather than a list, so that preferences compare by value.
    /// </summary>
    public string MenuOrder { get; init; } = "";
}
