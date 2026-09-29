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

    /// <summary>Creates a note.</summary>
    /// <param name="request">Text, attachment IDs and pin state.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The new note.</returns>
    /// <response code="201">The note was created.</response>
    /// <response code="400">The text is invalid or an attachment cannot be used.</response>
    [HttpPost]
    [ProducesResponseType<NoteResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<NoteResponse>> Create(CreateNoteRequest request, CancellationToken cancellationToken)
    {
        var note = await notes.CreateAsync(User.GetUserId(), request, cancellationToken);
        return CreatedAtAction(nameof(Get), new { id = note.Id }, note);
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
    /// <param name="kinds">Count only notes of these kinds (repeat the parameter); default: every kind.</param>
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
