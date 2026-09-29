using MapleNotes.Server.Domain;
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

    /// <summary>
    /// Which kinds of notes to list (repeat the parameter for several). Default: <see cref="NoteKind.Note"/>, the
    /// timeline.
    /// </summary>
    [FromQuery(Name = "kind")]
    public NoteKind[]? Kinds { get; init; }

    /// <summary>The <c>nextCursor</c> of the previous page; omit for the first page.</summary>
    public string? Cursor { get; init; }

    /// <summary>Page size, 1–100. Default: 20.</summary>
    public int? Limit { get; init; }

    /// <summary>Only notes with this tag (or a nested tag below it, e.g. <c>work</c> matches <c>work/meetings</c>).</summary>
    public string? Tag { get; init; }

    /// <summary>
    /// Only notes with one of these end-to-end tags, given as blind tokens (repeat the parameter). The browser sends the
    /// token of the tag and of every nested tag below it; combined with <see cref="Tag"/>, a note matching either is
    /// returned.
    /// </summary>
    [FromQuery(Name = "tagToken")]
    public string[]? TagTokens { get; init; }

    /// <summary>
    /// Only notes whose text or attachment names contain this text (case-insensitive). End-to-end encrypted notes never
    /// match: the browser searches those itself.
    /// </summary>
    [FromQuery(Name = "q")]
    public string? Search { get; init; }
}

/// <summary>
/// A note as returned by the API: decrypted when the server encrypted it, as stored when the browser did.
/// </summary>
/// <param name="Id">Note ID.</param>
/// <param name="Content">Markdown text; null for an end-to-end encrypted note.</param>
/// <param name="IsPinned">Whether the note is pinned above the feed.</param>
/// <param name="IsArchived">Whether the note is archived.</param>
/// <param name="CreatedAtUtc">When the note was created.</param>
/// <param name="UpdatedAtUtc">When the text was last edited.</param>
/// <param name="Tags">Tags found in the text; empty for an end-to-end encrypted note (the browser reads them from the text).</param>
/// <param name="Attachments">Attached files, oldest first.</param>
/// <param name="EncryptedContent">The envelope of an end-to-end encrypted note (base64), for the browser to decrypt.</param>
/// <param name="Kind">Where the note belongs: the timeline, the Todo tab or the Quick notes tab.</param>
/// <param name="DailyDate">For a daily note, the day it belongs to.</param>
public sealed record NoteResponse(
    Guid Id,
    string? Content,
    bool IsPinned,
    bool IsArchived,
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc,
    IReadOnlyList<string> Tags,
    IReadOnlyList<AttachmentResponse> Attachments,
    byte[]? EncryptedContent = null,
    NoteKind Kind = NoteKind.Note,
    DateOnly? DailyDate = null);

/// <summary>One page of notes, newest first.</summary>
/// <param name="Items">The notes.</param>
/// <param name="NextCursor">Pass as <c>cursor</c> to get the next page; null when there are no more notes.</param>
public sealed record NotePageResponse(IReadOnlyList<NoteResponse> Items, string? NextCursor);

/// <summary>An end-to-end encrypted tag: its blind token and its encrypted name (docs/e2ee-spec.md §4).</summary>
/// <param name="Token">HMAC token of the normalized name, 22 base64url characters.</param>
/// <param name="Name">The normalized name, encrypted by the browser (base64).</param>
public sealed record EncryptedTag(string Token, byte[] Name);

/// <summary>Note text encrypted by the browser (docs/e2ee-spec.md §2), with the note's tags.</summary>
/// <param name="Content">The envelope (base64), bound to the account and the note's ID.</param>
/// <param name="Tags">The tags in the text.</param>
public sealed record EncryptedNote(byte[] Content, IReadOnlyList<EncryptedTag>? Tags = null);

/// <summary>Request to create a note.</summary>
/// <remarks>
/// Accounts in end-to-end mode send <paramref name="Encrypted"/> and <paramref name="Id"/> instead of
/// <paramref name="Content"/>; all other accounts send plain text.
/// </remarks>
/// <param name="Content">Markdown text, up to 100,000 characters. May be empty if files are attached.</param>
/// <param name="AttachmentIds">IDs of uploaded files to attach.</param>
/// <param name="IsPinned">Pin the note above the feed.</param>
/// <param name="Id">For an end-to-end note: the ID the browser chose and bound into the ciphertext (UUID version 7).</param>
/// <param name="Encrypted">For an end-to-end note: the encrypted text and tags.</param>
/// <param name="Kind">A timeline note (the default), a todo list or a quick note.</param>
/// <param name="DailyDate">Makes a timeline note the daily note of this day; each day has at most one.</param>
public sealed record CreateNoteRequest(
    string? Content = null,
    IReadOnlyList<Guid>? AttachmentIds = null,
    bool IsPinned = false,
    Guid? Id = null,
    EncryptedNote? Encrypted = null,
    NoteKind Kind = NoteKind.Note,
    DateOnly? DailyDate = null);

/// <summary>A note restored from an export, with its original ID, dates, state, kind and daily date.</summary>
/// <remarks>Like a new note, it is plain text for most accounts and encrypted by the browser for end-to-end ones.</remarks>
/// <param name="CreatedAtUtc">When the note was originally created.</param>
/// <param name="UpdatedAtUtc">When it was last edited; not before <paramref name="CreatedAtUtc"/>.</param>
/// <param name="Id">The note's original ID. A plain note whose ID another account uses gets a new one; an end-to-end
/// note must then be encrypted again for a new ID (409).</param>
/// <param name="Content">Markdown text (plain accounts).</param>
/// <param name="Encrypted">Encrypted text and tags (end-to-end accounts).</param>
/// <param name="AttachmentIds">IDs of uploaded files to attach.</param>
/// <param name="IsPinned">Whether it was pinned.</param>
/// <param name="IsArchived">Whether it was archived.</param>
/// <param name="Kind">Timeline note, todo list or quick note.</param>
/// <param name="DailyDate">Its day, for a daily note. Dropped if the account already has a daily note for that day.</param>
public sealed record ImportNoteRequest(
    DateTime CreatedAtUtc,
    DateTime UpdatedAtUtc,
    Guid? Id = null,
    string? Content = null,
    EncryptedNote? Encrypted = null,
    IReadOnlyList<Guid>? AttachmentIds = null,
    bool IsPinned = false,
    bool IsArchived = false,
    NoteKind Kind = NoteKind.Note,
    DateOnly? DailyDate = null);

/// <summary>The result of restoring one note.</summary>
/// <param name="Imported">False when the account already had the note (same ID), which was left unchanged.</param>
/// <param name="Note">The restored note, or the one the account already had.</param>
public sealed record ImportNoteResponse(bool Imported, NoteResponse Note);

/// <summary>IDs of notes about to be restored.</summary>
/// <param name="Ids">Up to 500 note IDs.</param>
public sealed record ImportExistingRequest(IReadOnlyList<Guid> Ids);

/// <summary>Which of the IDs the account already has; restoring skips those.</summary>
/// <param name="Existing">The IDs of notes the account has.</param>
public sealed record ImportExistingResponse(IReadOnlyList<Guid> Existing);

/// <summary>Request to replace a note's text (and optionally its attachments).</summary>
/// <param name="Content">New Markdown text; accounts in end-to-end mode send <paramref name="Encrypted"/> instead.</param>
/// <param name="AttachmentIds">
/// The complete list of attachments the note should have. Files left out are deleted. Omit to keep them unchanged.
/// </param>
/// <param name="Encrypted">For an end-to-end account: the new text and tags, encrypted by the browser.</param>
public sealed record UpdateNoteRequest(string? Content = null, IReadOnlyList<Guid>? AttachmentIds = null, EncryptedNote? Encrypted = null);

/// <summary>Request to pin, unpin, archive, restore or move a note. Omitted fields are unchanged.</summary>
/// <param name="IsPinned">Pin or unpin.</param>
/// <param name="IsArchived">Archive (soft-delete) or restore.</param>
/// <param name="Kind">Move the note, for example a quick note to the timeline. A daily note moved out of the timeline
/// stops being the day's daily note.</param>
public sealed record PatchNoteRequest(bool? IsPinned = null, bool? IsArchived = null, NoteKind? Kind = null);

/// <summary>A tag and how many active notes (of the requested kinds) use it.</summary>
/// <param name="Name">Tag name without <c>#</c>; null for an end-to-end tag.</param>
/// <param name="NoteCount">Number of active notes with the tag.</param>
/// <param name="Token">The blind token of an end-to-end tag; pass it as <c>tagToken</c> to filter notes.</param>
/// <param name="EncryptedName">The encrypted name of an end-to-end tag, for the browser to decrypt.</param>
public sealed record TagResponse(string? Name, int NoteCount, string? Token = null, byte[]? EncryptedName = null);
