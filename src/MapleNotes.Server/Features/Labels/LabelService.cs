using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.EndToEnd;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Labels;

/// <summary>
/// Creates, lists, changes and deletes an account's labels. A label's name follows the account's mode, like a note's
/// text: plain, or encrypted by the browser in end-to-end mode. After a change to or from end-to-end encryption the
/// browser converts existing names by saving them again in the new form (see <see cref="ConversionService"/>).
/// </summary>
/// <param name="db">Database context.</param>
/// <param name="keys">The account's encryption mode.</param>
/// <param name="cleanup">Deletes keys the account no longer needs once its last label is converted.</param>
/// <param name="time">Clock.</param>
public sealed class LabelService(MapleDbContext db, UserContentKeys keys, EncryptionKeyCleanup cleanup, TimeProvider time)
{
    /// <summary>Lists the account's labels, oldest first, with how many active notes carry each.</summary>
    /// <param name="userId">The owner.</param>
    /// <param name="kinds">Count only notes of these kinds; null or empty for every kind except habits.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The labels.</returns>
    /// <exception cref="ApiValidationException">A kind is not valid.</exception>
    public async Task<IReadOnlyList<LabelResponse>> ListAsync(Guid userId, NoteKind[]? kinds, CancellationToken cancellationToken)
    {
        var counted = db.Notes.Where(n => n.UserId == userId && n.ArchivedAtUtc == null && n.TrashedAtUtc == null);
        counted = NoteService.ValidateKinds(kinds) is { } wanted
            ? counted.Where(n => wanted.Contains(n.Kind))
            : counted.Where(n => n.Kind != NoteKind.Habit);

        var labels = await db.Labels.AsNoTracking()
            .Where(l => l.UserId == userId)
            .OrderBy(l => l.CreatedAtUtc)
            .ThenBy(l => l.Id)
            .ToListAsync(cancellationToken);
        if (labels.Count == 0)
        {
            return [];
        }

        // One pass over the notes and their label links, grouped by label (see NoteService.ListTagsAsync).
        var counts = await counted
            .SelectMany(n => n.Labels.Select(l => l.Id))
            .GroupBy(id => id)
            .Select(g => new { LabelId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.LabelId, g => g.Count, cancellationToken);
        return labels.Select(l => new LabelResponse(l.Id, l.Name, l.EncryptedName, l.Color, counts.GetValueOrDefault(l.Id), l.HideNotes)).ToList();
    }

    /// <summary>Creates a label.</summary>
    /// <param name="userId">The owner.</param>
    /// <param name="request">Its name (plain, or encrypted for an ID the browser chose) and colour.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The new label.</returns>
    /// <exception cref="ApiValidationException">The name, colour or ID is not acceptable.</exception>
    /// <exception cref="ApiProblemException">The account has as many labels as it may, the request does not match the
    /// account's mode, or the chosen ID is taken (409).</exception>
    public async Task<LabelResponse> CreateAsync(Guid userId, CreateLabelRequest request, CancellationToken cancellationToken)
    {
        var color = ValidateColor(request.Color ?? "Grey");
        if (await db.Labels.CountAsync(l => l.UserId == userId, cancellationToken) >= Label.MaxPerAccount)
        {
            throw new ApiProblemException(StatusCodes.Status409Conflict, $"You can have at most {Label.MaxPerAccount} labels.", "Delete one you no longer use first.");
        }

        var now = time.GetUtcNow().UtcDateTime;
        var endToEnd = await keys.GetModeAsync(userId, cancellationToken) == EncryptionMode.EndToEnd;
        var (name, encryptedName) = CheckName(endToEnd, request.Name, request.EncryptedName);
        Guid id;
        if (endToEnd)
        {
            if (EndToEndContent.ValidateClientId(request.Id, now) is { } idError)
            {
                throw new ApiValidationException("id", idError);
            }

            id = request.Id!.Value;
            if (await db.Labels.AnyAsync(l => l.Id == id, cancellationToken))
            {
                throw new ApiProblemException(StatusCodes.Status409Conflict, "A label with this ID already exists.");
            }
        }
        else
        {
            id = request.Id is null
                ? Guid.CreateVersion7()
                : throw new ApiValidationException("id", "Only end-to-end encrypted labels bring their own ID.");
        }

        var label = new Label
        {
            Id = id, UserId = userId, Name = name, EncryptedName = encryptedName, Color = color, HideNotes = request.HideNotes, CreatedAtUtc = now,
        };
        db.Labels.Add(label);
        await db.SaveChangesAsync(cancellationToken);
        return new LabelResponse(label.Id, label.Name, label.EncryptedName, label.Color, 0, label.HideNotes);
    }

    /// <summary>Renames or recolours a label.</summary>
    /// <param name="userId">The owner.</param>
    /// <param name="labelId">The label.</param>
    /// <param name="request">The changes.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The label, or null when the account has no such label.</returns>
    /// <exception cref="ApiValidationException">The name or colour is not acceptable.</exception>
    /// <exception cref="ApiProblemException">The name does not match the account's mode (409).</exception>
    public async Task<LabelResponse?> UpdateAsync(Guid userId, Guid labelId, UpdateLabelRequest request, CancellationToken cancellationToken)
    {
        var label = await db.Labels.SingleOrDefaultAsync(l => l.Id == labelId && l.UserId == userId, cancellationToken);
        if (label is null)
        {
            return null;
        }

        if (request.Color is { } color)
        {
            label.Color = ValidateColor(color);
        }

        if (request.HideNotes is { } hide)
        {
            label.HideNotes = hide;
        }

        var wasEndToEnd = label.EncryptedName is not null;
        if (request.Name is not null || request.EncryptedName is not null)
        {
            (label.Name, label.EncryptedName) = CheckName(
                await keys.GetModeAsync(userId, cancellationToken) == EncryptionMode.EndToEnd, request.Name, request.EncryptedName);
        }

        await db.SaveChangesAsync(cancellationToken);
        if (wasEndToEnd != (label.EncryptedName is not null))
        {
            await cleanup.RunAsync(userId, cancellationToken); // converted: the old key may no longer be needed
        }

        // From the label's links (indexed by label), not by reading every note.
        var count = await db.Notes
            .Where(n => n.UserId == userId && n.ArchivedAtUtc == null && n.TrashedAtUtc == null && n.Kind != NoteKind.Habit)
            .SelectMany(n => n.Labels.Where(l => l.Id == labelId))
            .CountAsync(cancellationToken);
        return new LabelResponse(label.Id, label.Name, label.EncryptedName, label.Color, count, label.HideNotes);
    }

    /// <summary>Deletes a label; the notes that carried it keep everything else.</summary>
    /// <param name="userId">The owner.</param>
    /// <param name="labelId">The label.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>False when the account has no such label.</returns>
    public async Task<bool> DeleteAsync(Guid userId, Guid labelId, CancellationToken cancellationToken)
    {
        var deleted = await db.Labels.Where(l => l.Id == labelId && l.UserId == userId).ExecuteDeleteAsync(cancellationToken) > 0;
        if (deleted)
        {
            await cleanup.RunAsync(userId, cancellationToken); // it may have been the last end-to-end item
        }

        return deleted;
    }

    private static string ValidateColor(string color) =>
        Label.Colors.FirstOrDefault(c => string.Equals(c, color, StringComparison.OrdinalIgnoreCase))
        ?? throw new ApiValidationException("color", $"Choose one of: {string.Join(", ", Label.Colors)}.");

    /// <summary>Checks that a label's name has the form the account's mode needs: plain, or encrypted by the browser.</summary>
    /// <returns>The name to store, exactly one of them set.</returns>
    private static (string? Name, byte[]? EncryptedName) CheckName(bool endToEnd, string? name, byte[]? encryptedName)
    {
        if (endToEnd)
        {
            if (name is not null)
            {
                throw new ApiProblemException(
                    StatusCodes.Status409Conflict,
                    "This account uses end-to-end encryption.",
                    "Send the label's name encrypted by the app, as encryptedName.");
            }

            return EndToEndContent.IsEnvelope(encryptedName, EndToEndContent.MaxLabelNameEnvelopeBytes)
                ? (null, encryptedName)
                : throw new ApiValidationException("encryptedName", "This is not an encrypted label name.");
        }

        if (encryptedName is not null)
        {
            throw new ApiProblemException(
                StatusCodes.Status409Conflict,
                "This account does not use end-to-end encryption.",
                "Send the label's name as it is; the server protects it with the rest of the database.");
        }

        var clean = name?.Trim() ?? string.Empty;
        if (clean.Length is 0 or > Label.MaxNameLength)
        {
            throw new ApiValidationException("name", $"A label's name is 1 to {Label.MaxNameLength} characters long.");
        }

        return (clean, null);
    }
}
