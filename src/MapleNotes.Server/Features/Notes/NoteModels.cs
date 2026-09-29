using MapleNotes.Server.Features.Attachments;
using Microsoft.AspNetCore.Mvc;

namespace MapleNotes.Server.Features.Notes;

/// <summary>Which notes a list request returns.</summary>
public enum NoteState
{
    /// <summary>The home feed: active notes that are not pinned (pinned notes are listed separately above it).</summary>
    Feed,

    /// <summary>Active pinned notes.</summary>
    Pinned,

    /// <summary>All active notes, pinned or not; used for search and tag views.</summary>
    Active,

    /// <summary>Archived notes.</summary>
    Archived,
}

/// <summary>Query parameters for listing notes.</summary>
public sealed record NoteListQuery
{
    /// <summary>Which notes to list. Default: <see cref="NoteState.Feed"/>.</summary>
    public NoteState State { get; init; } = NoteState.Feed;

    /// <summary>The <c>nextCursor</c> of the previous page; omit for the first page.</summary>
    public string? Cursor { get; init; }

    /// <summary>Page size, 1–100. Default: 20.</summary>
    public int? Limit { get; init; }

    /// <summary>Only notes with this tag (or a nested tag below it, e.g. <c>work</c> matches <c>work/meetings</c>).</summary>
    public string? Tag { get; init; }

    /// <summary>Only notes whose text or attachment names contain this text (case-insensitive).</summary>
    [FromQuery(Name = "q")]
    public string? Search { get; init; }
}

/// <summary>A note as returned by the API (always decrypted).</summary>
/// <param name="Id">Note ID.</param>
/// <param name="Content">Markdown text.</param>
/// <param name="IsPinned">Whether the note is pinned above the feed.</param>
/// <param name="IsArchived">Whether the note is archived.</param>
/// <param name="CreatedAtUtc">When the note was created.</param>
/// <param name="UpdatedAtUtc">When the text was last edited.</param>
/// <param name="Tags">Tags found in the text.</param>
/// <param name="Attachments">Attached files, oldest first.</param>
public sealed record NoteResponse(
    Guid Id,
    string Content,
    bool IsPinned,
    bool IsArchived,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc,
    IReadOnlyList<string> Tags,
    IReadOnlyList<AttachmentResponse> Attachments);

/// <summary>One page of notes, newest first.</summary>
/// <param name="Items">The notes.</param>
/// <param name="NextCursor">Pass as <c>cursor</c> to get the next page; null when there are no more notes.</param>
public sealed record NotePageResponse(IReadOnlyList<NoteResponse> Items, string? NextCursor);

/// <summary>Request to create a note.</summary>
/// <param name="Content">Markdown text, up to 100,000 characters. May be empty if files are attached.</param>
/// <param name="AttachmentIds">IDs of uploaded files to attach.</param>
/// <param name="IsPinned">Pin the note above the feed.</param>
public sealed record CreateNoteRequest(string Content, IReadOnlyList<Guid>? AttachmentIds = null, bool IsPinned = false);

/// <summary>Request to replace a note's text (and optionally its attachments).</summary>
/// <param name="Content">New Markdown text.</param>
/// <param name="AttachmentIds">
/// The complete list of attachments the note should have. Files left out are deleted. Omit to keep them unchanged.
/// </param>
public sealed record UpdateNoteRequest(string Content, IReadOnlyList<Guid>? AttachmentIds = null);

/// <summary>Request to pin, unpin, archive or restore a note. Omitted fields are unchanged.</summary>
/// <param name="IsPinned">Pin or unpin.</param>
/// <param name="IsArchived">Archive (soft-delete) or restore.</param>
public sealed record PatchNoteRequest(bool? IsPinned = null, bool? IsArchived = null);

/// <summary>A tag and how many active notes use it.</summary>
/// <param name="Name">Tag name without <c>#</c>.</param>
/// <param name="NoteCount">Number of active notes with the tag.</param>
public sealed record TagResponse(string Name, int NoteCount);
