using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Auth;
using Microsoft.AspNetCore.Mvc;

namespace MapleNotes.Server.Features.Notes;

/// <summary>The signed-in user's notes.</summary>
/// <param name="notes">Note operations.</param>
[ApiController]
[Route("api/v1/notes")]
[Produces("application/json")]
public sealed class NotesController(NoteService notes) : ControllerBase
{
    /// <summary>Lists notes, newest first, one page at a time.</summary>
    /// <remarks>
    /// Pages are cursor-based: pass the <c>nextCursor</c> of a page as <c>cursor</c> to get the next one. The default
    /// <c>feed</c> state excludes pinned notes, which are listed separately with <c>state=pinned</c>.
    /// </remarks>
    /// <param name="query">Filters and paging.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>One page of notes.</returns>
    /// <response code="200">The page.</response>
    /// <response code="400">The cursor is invalid.</response>
    [HttpGet]
    [ProducesResponseType<NotePageResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public Task<NotePageResponse> List([FromQuery] NoteListQuery query, CancellationToken cancellationToken) =>
        notes.ListAsync(User.GetUserId(), query, cancellationToken);

    /// <summary>Returns one note.</summary>
    /// <param name="id">Note ID.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The note.</returns>
    /// <response code="200">The note.</response>
    /// <response code="404">No such note for this account.</response>
    [HttpGet("{id:guid}")]
    [ProducesResponseType<NoteResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<NoteResponse>> Get(Guid id, CancellationToken cancellationToken) =>
        await notes.GetAsync(User.GetUserId(), id, cancellationToken) is { } note ? note : NotFound();

    /// <summary>Counts active notes per day, for a calendar.</summary>
    /// <param name="query">The days (at most 62), the time zone whose days are counted, and which kinds to count.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The days that have notes, with how many.</returns>
    /// <response code="200">The days.</response>
    /// <response code="400">The range, time zone or a kind is not valid.</response>
    [HttpGet("calendar")]
    [ProducesResponseType<IReadOnlyList<CalendarDayResponse>>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public Task<IReadOnlyList<CalendarDayResponse>> Calendar([FromQuery] CalendarQuery query, CancellationToken cancellationToken) =>
        notes.CalendarAsync(User.GetUserId(), query, cancellationToken);

    /// <summary>Returns the daily note of a day.</summary>
    /// <param name="date">The day, as <c>yyyy-MM-dd</c>.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The note.</returns>
    /// <response code="200">The day's daily note.</response>
    /// <response code="404">The day has no daily note yet.</response>
    [HttpGet("daily/{date}")]
    [ProducesResponseType<NoteResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<NoteResponse>> GetDaily(DateOnly date, CancellationToken cancellationToken) =>
        await notes.GetDailyAsync(User.GetUserId(), date, cancellationToken) is { } note ? note : NotFound();

    /// <summary>Creates a note.</summary>
    /// <param name="request">Text, attachment IDs and pin state.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The new note.</returns>
    /// <response code="201">The note was created.</response>
    /// <response code="400">The text is invalid or an attachment cannot be used.</response>
    /// <response code="409">The day already has a daily note, or the request does not match the account's encryption mode.</response>
    [HttpPost]
    [ProducesResponseType<NoteResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<NoteResponse>> Create(CreateNoteRequest request, CancellationToken cancellationToken)
    {
        var note = await notes.CreateAsync(User.GetUserId(), request, cancellationToken);
        return CreatedAtAction(nameof(Get), new { id = note.Id }, note);
    }

    /// <summary>Tells which notes of an export the account already has, so restoring can skip them.</summary>
    /// <param name="request">Up to 500 note IDs.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The IDs the account already has.</returns>
    /// <response code="200">The IDs.</response>
    /// <response code="400">Too many IDs.</response>
    [HttpPost("import/existing")]
    [ProducesResponseType<ImportExistingResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<ImportExistingResponse> ImportExisting(ImportExistingRequest request, CancellationToken cancellationToken) =>
        new(await notes.FindExistingAsync(User.GetUserId(), request.Ids ?? [], cancellationToken));

    /// <summary>Restores one note from an export, keeping its ID, dates, state, kind and daily date.</summary>
    /// <remarks>Upload its files first, as for a new note. A note the account already has is left unchanged.</remarks>
    /// <param name="request">The note.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>Whether it was restored, and the note.</returns>
    /// <response code="201">The note was restored.</response>
    /// <response code="200">The account already had this note; nothing changed.</response>
    /// <response code="400">The note is not valid.</response>
    /// <response code="409">The request does not match the account's encryption mode, or an end-to-end note's ID is not available.</response>
    [HttpPost("import")]
    [ProducesResponseType<ImportNoteResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType<ImportNoteResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<ImportNoteResponse>> Import(ImportNoteRequest request, CancellationToken cancellationToken)
    {
        var result = await notes.ImportAsync(User.GetUserId(), request, cancellationToken);
        return result.Imported ? CreatedAtAction(nameof(Get), new { id = result.Note.Id }, result) : Ok(result);
    }

    /// <summary>Replaces a note's text and, optionally, its attachments.</summary>
    /// <param name="id">Note ID.</param>
    /// <param name="request">New text; optionally the complete list of attachment IDs to keep.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The updated note.</returns>
    /// <response code="200">The note was updated.</response>
    /// <response code="400">The text is invalid or an attachment cannot be used.</response>
    /// <response code="404">No such note for this account.</response>
    [HttpPut("{id:guid}")]
    [ProducesResponseType<NoteResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<NoteResponse>> Update(Guid id, UpdateNoteRequest request, CancellationToken cancellationToken) =>
        await notes.UpdateAsync(User.GetUserId(), id, request, cancellationToken) is { } note ? note : NotFound();

    /// <summary>Pins, unpins, archives, restores or moves a note.</summary>
    /// <param name="id">Note ID.</param>
    /// <param name="request">The changes.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The updated note.</returns>
    /// <response code="200">The note was updated.</response>
    /// <response code="404">No such note for this account.</response>
    [HttpPatch("{id:guid}")]
    [ProducesResponseType<NoteResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<NoteResponse>> Patch(Guid id, PatchNoteRequest request, CancellationToken cancellationToken) =>
        await notes.PatchAsync(User.GetUserId(), id, request, cancellationToken) is { } note ? note : NotFound();

    /// <summary>Permanently deletes a note and its attachments. To keep a note out of sight instead, archive it.</summary>
    /// <param name="id">Note ID.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>No content.</returns>
    /// <response code="204">The note was deleted.</response>
    /// <response code="404">No such note for this account.</response>
    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken) =>
        await notes.DeleteAsync(User.GetUserId(), id, cancellationToken) ? NoContent() : NotFound();
}

/// <summary>The signed-in user's tags.</summary>
/// <param name="notes">Note operations.</param>
[ApiController]
[Route("api/v1/tags")]
[Produces("application/json")]
public sealed class TagsController(NoteService notes) : ControllerBase
{
    /// <summary>Lists tags used by active notes, with note counts.</summary>
    /// <param name="kinds">Count only notes of these kinds (repeat the parameter); default: every kind except habits.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>Tags in alphabetical order.</returns>
    /// <response code="200">The tags.</response>
    /// <response code="400">A kind is not valid.</response>
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<TagResponse>>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public Task<IReadOnlyList<TagResponse>> List([FromQuery(Name = "kind")] NoteKind[]? kinds, CancellationToken cancellationToken) =>
        notes.ListTagsAsync(User.GetUserId(), kinds, cancellationToken);
}
