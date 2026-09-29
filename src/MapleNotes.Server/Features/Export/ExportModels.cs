using MapleNotes.Server.Domain;
namespace MapleNotes.Server.Features.Export;

/// <summary>File format of the exported notes.</summary>
public enum ExportFormat
{
    /// <summary>Markdown with YAML front matter (<c>.md</c>); attachments are linked, images embedded.</summary>
    Md,

    /// <summary>Plain text with a short header (<c>.txt</c>).</summary>
    Txt,

    /// <summary>One JSON document per note (<c>.json</c>).</summary>
    Json,
}

/// <summary>How note files are arranged in folders, by the note's creation date in the requested time zone.</summary>
public enum ExportLayout
{
    /// <summary>All notes in the archive root.</summary>
    Flat,

    /// <summary><c>YYYY/</c> folders.</summary>
    Year,

    /// <summary><c>YYYY-MM/</c> folders.</summary>
    Month,

    /// <summary><c>YYYY-MM-DD/</c> folders.</summary>
    Day,
}

/// <summary>Export options (query string).</summary>
public sealed record ExportRequest
{
    /// <summary>File format: <c>md</c> (default), <c>txt</c> or <c>json</c>.</summary>
    public ExportFormat Format { get; init; } = ExportFormat.Md;

    /// <summary>Folder layout: <c>flat</c>, <c>year</c>, <c>month</c> (default) or <c>day</c>.</summary>
    public ExportLayout Layout { get; init; } = ExportLayout.Month;

    /// <summary>Include archived notes. Default: false.</summary>
    public bool IncludeArchived { get; init; }

    /// <summary>Include attached files, decrypted, under <c>/attachments</c>. Default: true.</summary>
    public bool IncludeAttachments { get; init; } = true;

    /// <summary>Only notes created on or after this date (in <see cref="TimeZone"/>).</summary>
    public DateOnly? From { get; init; }

    /// <summary>Only notes created on or before this date (in <see cref="TimeZone"/>).</summary>
    public DateOnly? To { get; init; }

    /// <summary>IANA time zone for folder names and timestamps, e.g. <c>Europe/Paris</c>. Default: UTC.</summary>
    public string? TimeZone { get; init; }
}

/// <summary>An attachment as written into an export.</summary>
/// <param name="FileName">Original file name.</param>
/// <param name="ContentType">Media type.</param>
/// <param name="SizeBytes">Size of the file.</param>
/// <param name="IsImage">Whether it is an image (embedded rather than linked in Markdown).</param>
/// <param name="ArchivePath">Path inside the archive, e.g. <c>attachments/5d1e0a7c_sunset.png</c>.</param>
/// <param name="RelativePath">Path relative to the note file that references it, e.g. <c>../attachments/…</c>.</param>
public sealed record ExportedAttachment(
    string FileName, string ContentType, long SizeBytes, bool IsImage, string ArchivePath, string RelativePath);

/// <summary>A note as written into an export (always decrypted).</summary>
/// <param name="Id">Note ID.</param>
/// <param name="Content">Markdown text.</param>
/// <param name="Created">Creation time in the export's time zone.</param>
/// <param name="Updated">Last edit time in the export's time zone.</param>
/// <param name="Tags">Tags.</param>
/// <param name="Pinned">Whether the note is pinned.</param>
/// <param name="Archived">Whether the note is archived.</param>
/// <param name="Attachments">Attached files included in the export.</param>
/// <param name="Kind">A timeline note, a todo list or a quick note.</param>
/// <param name="DailyDate">For a daily note, its day.</param>
public sealed record ExportedNote(
    Guid Id,
    string Content,
    DateTimeOffset Created,
    DateTimeOffset Updated,
    IReadOnlyList<string> Tags,
    bool Pinned,
    bool Archived,
    IReadOnlyList<ExportedAttachment> Attachments,
    NoteKind Kind = NoteKind.Note,
    DateOnly? DailyDate = null)
{
    /// <summary>The kind as written in exports: <c>note</c>, <c>todo</c> or <c>quick</c>.</summary>
    public string KindName => Kind.ToString().ToLowerInvariant();
}
