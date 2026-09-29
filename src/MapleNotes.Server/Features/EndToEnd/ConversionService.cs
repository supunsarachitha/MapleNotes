using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.EndToEnd;

/// <summary>
/// Serves the browser's conversion of existing content when an account changes to or from end-to-end encryption
/// (docs/e2ee-spec.md §3). Only the browser holds the end-to-end key, so it fetches batches of items, converts each,
/// and sends it back; this service hands out the batches and applies each conversion atomically.
/// </summary>
/// <remarks>
/// Progress lives in the data itself (every item records its scheme), so the conversion resumes after a reload or a
/// crash and survives the user switching back mid-way. A note converts only if it was not edited since its batch was
/// fetched, so a conversion never overwrites an edit, and converting leaves the note's timestamps alone.
/// </remarks>
/// <param name="db">Database context.</param>
/// <param name="notes">Note operations.</param>
/// <param name="attachments">Attachment operations.</param>
/// <param name="cleanup">Deletes keys the account no longer needs.</param>
public sealed class ConversionService(MapleDbContext db, NoteService notes, AttachmentService attachments, EncryptionKeyCleanup cleanup)
{
    /// <summary>Most items in one batch.</summary>
    public const int MaxBatchSize = 50;

    /// <summary>Returns the next items to convert: plain ones in end-to-end mode, end-to-end ones otherwise.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="limit">Batch size, 1–50; default 20.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The batch; empty when nothing is left for the browser.</returns>
    public async Task<ConversionBatchResponse> GetBatchAsync(Guid userId, int? limit, CancellationToken cancellationToken)
    {
        var mode = await ModeAsync(userId, cancellationToken);
        var entering = mode == EncryptionMode.EndToEnd;
        var pendingNotes = db.Notes.AsNoTracking()
            .Where(n => n.UserId == userId && (entering ? n.Scheme != ContentScheme.EndToEnd : n.Scheme == ContentScheme.EndToEnd));
        var pendingAttachments = db.Attachments.AsNoTracking()
            .Where(a => a.UserId == userId && (entering ? a.Scheme != ContentScheme.EndToEnd : a.Scheme == ContentScheme.EndToEnd));
        var remaining = await pendingNotes.CountAsync(cancellationToken) + await pendingAttachments.CountAsync(cancellationToken);

        var take = Math.Clamp(limit ?? 20, 1, MaxBatchSize);
        var noteBatch = await pendingNotes.OrderBy(n => n.CreatedAtUtc).ThenBy(n => n.Id).Take(take).ToListAsync(cancellationToken);
        var convertNotes = new List<ConversionNote>(noteBatch.Count);
        foreach (var note in noteBatch)
        {
            convertNotes.Add(entering
                ? new ConversionNote(note.Id, await notes.ReadContentAsync(note, cancellationToken), null, note.UpdatedAtUtc)
                : new ConversionNote(note.Id, null, note.Content, note.UpdatedAtUtc));
        }

        var attachmentBatch = noteBatch.Count >= take
            ? []
            : await pendingAttachments.OrderBy(a => a.CreatedAtUtc).ThenBy(a => a.Id).Take(take - noteBatch.Count).ToListAsync(cancellationToken);
        var convertAttachments = attachmentBatch
            .Select(a => entering
                ? new ConversionAttachment(a.Id, a.FileName, a.ContentType, a.SizeBytes, null)
                : new ConversionAttachment(a.Id, null, null, a.SizeBytes, a.EncryptedMetadata))
            .ToList();
        return new ConversionBatchResponse(mode, remaining, convertNotes, convertAttachments);
    }

    /// <summary>Applies the browser's conversion of one note.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="noteId">The note.</param>
    /// <param name="request">The converted text, and the note's last-edit time from the batch.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>A task that completes when the note is converted.</returns>
    /// <exception cref="ApiProblemException">The note is gone (404), already converted, or was edited meanwhile (409).</exception>
    /// <exception cref="ApiValidationException">The converted text is missing or malformed.</exception>
    public async Task ConvertNoteAsync(Guid userId, Guid noteId, ConvertNoteRequest request, CancellationToken cancellationToken)
    {
        var note = await NoteService.WithDetails(db.Notes).SingleOrDefaultAsync(n => n.Id == noteId && n.UserId == userId, cancellationToken)
            ?? throw new ApiProblemException(StatusCodes.Status404NotFound, "The note no longer exists.");
        var entering = await ModeAsync(userId, cancellationToken) == EncryptionMode.EndToEnd;
        if (entering == (note.Scheme == ContentScheme.EndToEnd))
        {
            throw new ApiProblemException(StatusCodes.Status409Conflict, "This note is already converted.");
        }

        if (note.UpdatedAtUtc != request.UpdatedAtUtc)
        {
            throw new ApiProblemException(
                StatusCodes.Status409Conflict, "This note changed while it was being converted.", "Fetch it again and convert its new text.");
        }

        if (entering)
        {
            await notes.ApplyEncryptedAsync(note, request.Encrypted ?? throw new ApiValidationException("encrypted", "Send the encrypted text."), cancellationToken);
        }
        else
        {
            var content = request.Content ?? throw new ApiValidationException("content", "Send the decrypted text.");
            if (content.Length > NoteService.MaxContentLength)
            {
                throw new ApiValidationException("content", $"A note can be at most {NoteService.MaxContentLength:N0} characters long.");
            }

            await notes.ApplyPlainTextAsync(note, content, cancellationToken);
        }

        await db.SaveChangesAsync(cancellationToken); // UpdatedAtUtc stays: converting is not editing
        await notes.RemoveUnusedTagsAsync(userId, cancellationToken);
        await cleanup.RunAsync(userId, cancellationToken);
    }

    /// <summary>Applies the browser's conversion of one file.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="attachmentId">The attachment.</param>
    /// <param name="file">The converted file, with its encrypted metadata when entering end-to-end mode.</param>
    /// <param name="cancellationToken">Cancels the operation; nothing changes.</param>
    /// <returns>A task that completes when the attachment uses the converted file.</returns>
    /// <exception cref="ApiProblemException">The file is gone (404) or already converted (409).</exception>
    internal async Task<bool> ConvertAttachmentAsync(Guid userId, Guid attachmentId, UploadedFile file, CancellationToken cancellationToken)
    {
        var attachment = await db.Attachments.SingleOrDefaultAsync(a => a.Id == attachmentId && a.UserId == userId, cancellationToken)
            ?? throw new ApiProblemException(StatusCodes.Status404NotFound, "The file no longer exists.");
        await attachments.ReplaceContentAsync(
            attachment, file.Body, file.FileName, file.ContentType, file.Base64("metadata", EndToEndContent.MaxMetadataEnvelopeBytes), cancellationToken);
        await cleanup.RunAsync(userId, cancellationToken);
        return true;
    }

    /// <summary>The most bytes a conversion of this file can send: its size plus the encryption overhead.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="attachmentId">The attachment.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The limit, or null when there is no such file.</returns>
    public async Task<long?> MaxAttachmentBytesAsync(Guid userId, Guid attachmentId, CancellationToken cancellationToken)
    {
        var size = await db.Attachments.Where(a => a.Id == attachmentId && a.UserId == userId)
            .Select(a => (long?)a.SizeBytes).SingleOrDefaultAsync(cancellationToken);
        return size is { } bytes ? EndToEndContent.MaxAttachmentCiphertextBytes(bytes) : null;
    }

    private Task<EncryptionMode> ModeAsync(Guid userId, CancellationToken cancellationToken) =>
        db.Users.Where(u => u.Id == userId).Select(u => u.EncryptionMode).SingleAsync(cancellationToken);
}
