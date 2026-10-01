using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Auth;
using Microsoft.AspNetCore.Mvc;

namespace MapleNotes.Server.Features.Labels;

/// <summary>The signed-in user's labels. Put them on notes with <c>PATCH /api/v1/notes/{id}</c> and <c>labelIds</c>.</summary>
/// <param name="labels">Label operations.</param>
[ApiController]
[Route("api/v1/labels")]
[Produces("application/json")]
public sealed class LabelsController(LabelService labels) : ControllerBase
{
    /// <summary>Lists the labels, oldest first, with how many active notes carry each.</summary>
    /// <param name="kinds">Count only notes of these kinds (repeat the parameter); default: every kind except habits.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The labels.</returns>
    /// <response code="200">The labels.</response>
    /// <response code="400">A kind is not valid.</response>
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<LabelResponse>>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public Task<IReadOnlyList<LabelResponse>> List([FromQuery(Name = "kind")] NoteKind[]? kinds, CancellationToken cancellationToken) =>
        labels.ListAsync(User.GetUserId(), kinds, cancellationToken);

    /// <summary>Creates a label.</summary>
    /// <param name="request">Its name and colour.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The new label.</returns>
    /// <response code="201">The label was created.</response>
    /// <response code="400">The name, colour or ID is not acceptable.</response>
    /// <response code="409">The account has 100 labels already, the request does not match the account's encryption mode, or the ID is taken.</response>
    [HttpPost]
    [ProducesResponseType<LabelResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<LabelResponse>> Create(CreateLabelRequest request, CancellationToken cancellationToken)
    {
        var label = await labels.CreateAsync(User.GetUserId(), request, cancellationToken);
        return Created($"/api/v1/labels/{label.Id}", label);
    }

    /// <summary>Renames or recolours a label.</summary>
    /// <param name="id">Label ID.</param>
    /// <param name="request">The changes.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The label.</returns>
    /// <response code="200">The label was changed.</response>
    /// <response code="400">The name or colour is not acceptable.</response>
    /// <response code="404">No such label for this account.</response>
    /// <response code="409">The name does not match the account's encryption mode.</response>
    [HttpPut("{id:guid}")]
    [ProducesResponseType<LabelResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<LabelResponse>> Update(Guid id, UpdateLabelRequest request, CancellationToken cancellationToken) =>
        await labels.UpdateAsync(User.GetUserId(), id, request, cancellationToken) is { } label ? label : NotFound();

    /// <summary>Deletes a label. The notes that carried it are not changed otherwise.</summary>
    /// <param name="id">Label ID.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>No content.</returns>
    /// <response code="204">The label was deleted.</response>
    /// <response code="404">No such label for this account.</response>
    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken) =>
        await labels.DeleteAsync(User.GetUserId(), id, cancellationToken) ? NoContent() : NotFound();
}
