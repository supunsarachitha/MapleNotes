using System.Security.Cryptography;
using System.Text;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Features.EndToEnd;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Storage;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Notes;

/// <summary>
/// Creates, reads, updates, archives and deletes notes. Every operation is scoped to the owner, and note text is
/// encrypted or decrypted transparently according to the owner's encryption mode and each note's scheme.
/// </summary>
/// <param name="db">Database context.</param>
/// <param name="keys">Per-request data keys.</param>
/// <param name="store">Attachment file store.</param>
/// <param name="time">Clock.</param>
/// <param name="logger">Logger.</param>
public sealed class NoteService(
    MapleDbContext db, UserContentKeys keys, AttachmentStore store, TimeProvider time, ILogger<NoteService> logger)
{
    /// <summary>Maximum note length in characters.</summary>
    public const int MaxContentLength = 100_000;

    /// <summary>Default page size.</summary>
    public const int DefaultPageSize = 20;

    /// <summary>Largest page size.</summary>
    public const int MaxPageSize = 100;

    /// <summary>Shown in place of a note whose text cannot be decrypted (damaged data).</summary>
    public const string UnreadablePlaceholder = "⚠️ This note could not be decrypted. Its stored data may be damaged.";

    /// <summary>Stands in for the text of an end-to-end encrypted note, which only the owner's browser can read.</summary>
    public const string EndToEndPlaceholder = "🔒 This note is end-to-end encrypted.";

    // Search decrypts notes in memory, scanning in batches. One request scans at most this many notes, then returns
    // what it found with a cursor so the client can continue: response time stays bounded on large accounts.
    private const int SearchBatchSize = 200;
    private const int SearchScanLimit = 5_000;

    /// <summary>Lists one page of the user's notes, newest first.</summary>
    /// <param name="userId">The owner.</param>
    /// <param name="query">Which notes and which page.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The page and the cursor of the next one.</returns>
    /// <exception cref="ApiValidationException">The cursor is invalid.</exception>
    public async Task<NotePageResponse> ListAsync(Guid userId, NoteListQuery query, CancellationToken cancellationToken)
    {
        var limit = Math.Clamp(query.Limit ?? DefaultPageSize, 1, MaxPageSize);
        NoteCursor? cursor = null;
        if (query.Cursor is not null)
        {
            cursor = NoteCursor.TryParse(query.Cursor, out var parsed)
                ? parsed
                : throw new ApiValidationException("cursor", "The cursor is not valid. Start again from the first page.");
        }

        var tag = string.IsNullOrWhiteSpace(query.Tag) ? null : query.Tag.Trim().TrimStart('#').ToLowerInvariant();
        var tagTokens = query.TagTokens ?? [];
        if (tagTokens.Length > EndToEndContent.MaxTagsPerNote || !tagTokens.All(EndToEndContent.IsTagToken))
        {
            throw new ApiValidationException("tagToken", "Tag tokens are 22 base64url characters, at most 100 per request.");
        }

        var filter = new TagFilter(tag, tagTokens);
        var search = string.IsNullOrWhiteSpace(query.Search) ? null : query.Search.Trim();

        if (search is null)
        {
            var page = await LoadBatchAsync(userId, query.State, filter, cursor, limit + 1, cancellationToken);
            var items = new List<NoteResponse>(Math.Min(page.Count, limit));
            foreach (var note in page.Take(limit))
            {
                items.Add(await ToResponseAsync(note, cancellationToken));
            }

            var next = page.Count > limit ? new NoteCursor(page[limit - 1].CreatedAtUtc, page[limit - 1].Id).Encode() : null;
            return new NotePageResponse(items, next);
        }

        var matches = new List<NoteResponse>(limit);
        var scanned = 0;
        while (true)
        {
            var batch = await LoadBatchAsync(userId, query.State, filter, cursor, SearchBatchSize, cancellationToken);
            foreach (var note in batch)
            {
                scanned++;
                cursor = new NoteCursor(note.CreatedAtUtc, note.Id);
                var response = await ToResponseAsync(note, cancellationToken);
                if (Matches(response, search))
                {
                    matches.Add(response);
                    if (matches.Count == limit)
                    {
                        return new NotePageResponse(matches, cursor.Value.Encode());
                    }
                }
            }

            if (batch.Count < SearchBatchSize)
            {
                return new NotePageResponse(matches, null);
            }

            if (scanned >= SearchScanLimit)
            {
                return new NotePageResponse(matches, cursor!.Value.Encode());
            }
        }
    }

    /// <summary>Returns one of the user's notes.</summary>
    /// <param name="userId">The owner.</param>
    /// <param name="noteId">The note.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The note, or null when it does not exist or belongs to someone else.</returns>
    public async Task<NoteResponse?> GetAsync(Guid userId, Guid noteId, CancellationToken cancellationToken)
    {
        var note = await WithDetails(db.Notes.AsNoTracking())
            .SingleOrDefaultAsync(n => n.Id == noteId && n.UserId == userId, cancellationToken);
        return note is null ? null : await ToResponseAsync(note, cancellationToken);
    }

    /// <summary>Creates a note.</summary>
    /// <param name="userId">The owner.</param>
    /// <param name="request">Text (plain, or encrypted by the browser), attachments and pin state.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The new note.</returns>
    /// <exception cref="ApiValidationException">The text is too long, empty without attachments, malformed when
    /// encrypted, or an attachment ID is not an unattached upload of this user.</exception>
    /// <exception cref="ApiProblemException">The request does not match the account's mode (plain text for an
    /// end-to-end account or the reverse), or the chosen ID is taken.</exception>
    public async Task<NoteResponse> CreateAsync(Guid userId, CreateNoteRequest request, CancellationToken cancellationToken)
    {
        var attachmentIds = request.AttachmentIds ?? [];
        var now = time.GetUtcNow().UtcDateTime;
        Note note;
        if (request.Encrypted is { } encrypted)
        {
            await RequireEndToEndAsync(userId, cancellationToken);
            if (EndToEndContent.ValidateClientId(request.Id, now) is { } idError)
            {
                throw new ApiValidationException("id", idError);
            }

            if (await db.Notes.AnyAsync(n => n.Id == request.Id, cancellationToken))
            {
                throw new ApiProblemException(StatusCodes.Status409Conflict, "A note with this ID already exists.");
            }

            note = new Note { Id = request.Id!.Value, UserId = userId, IsPinned = request.IsPinned, CreatedAtUtc = now, UpdatedAtUtc = now };
            SetEncryptedContent(note, encrypted);
            await AttachAsync(note, attachmentIds, cancellationToken);
            await SetEncryptedTagsAsync(note, encrypted.Tags, cancellationToken);
        }
        else
        {
            if (request.Id is not null)
            {
                throw new ApiValidationException("id", "Only end-to-end encrypted notes bring their own ID.");
            }

            var content = ValidateContent(request.Content, attachmentIds.Count);
            note = new Note { UserId = userId, IsPinned = request.IsPinned, CreatedAtUtc = now, UpdatedAtUtc = now };
            await SetContentAsync(note, content, cancellationToken);
            await AttachAsync(note, attachmentIds, cancellationToken);
            await SetTagsAsync(note, content, cancellationToken);
        }

        db.Notes.Add(note);
        await db.SaveChangesAsync(cancellationToken);
        return await ToResponseAsync(note, cancellationToken);
    }

    /// <summary>Replaces a note's text and, optionally, its set of attachments.</summary>
    /// <param name="userId">The owner.</param>
    /// <param name="noteId">The note.</param>
    /// <param name="request">New text and attachment list.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The updated note, or null when it does not exist or belongs to someone else.</returns>
    /// <exception cref="ApiValidationException">The new content is invalid.</exception>
    public async Task<NoteResponse?> UpdateAsync(Guid userId, Guid noteId, UpdateNoteRequest request, CancellationToken cancellationToken)
    {
        var note = await WithDetails(db.Notes).SingleOrDefaultAsync(n => n.Id == noteId && n.UserId == userId, cancellationToken);
        if (note is null)
        {
            return null;
        }

        var wantedIds = request.AttachmentIds ?? note.Attachments.Select(a => a.Id).ToList();
        string? content = null;
        if (request.Encrypted is { } encrypted)
        {
            await RequireEndToEndAsync(userId, cancellationToken);
            SetEncryptedContent(note, encrypted);
        }
        else
        {
            content = ValidateContent(request.Content, wantedIds.Count);
            await SetContentAsync(note, content, cancellationToken);
        }

        var removedFiles = new List<string>();
        if (request.AttachmentIds is not null)
        {
            foreach (var removed in note.Attachments.Where(a => !wantedIds.Contains(a.Id)).ToList())
            {
                note.Attachments.Remove(removed);
                db.Attachments.Remove(removed);
                removedFiles.Add(removed.StorageKey);
            }

            await AttachAsync(note, wantedIds.Where(id => note.Attachments.All(a => a.Id != id)).ToList(), cancellationToken);
        }

        if (content is null)
        {
            await SetEncryptedTagsAsync(note, request.Encrypted!.Tags, cancellationToken);
        }
        else
        {
            await SetTagsAsync(note, content, cancellationToken);
        }

        note.UpdatedAtUtc = time.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(cancellationToken);

        foreach (var storageKey in removedFiles)
        {
            store.Delete(storageKey);
        }

        await RemoveUnusedTagsAsync(userId, cancellationToken);
        return await ToResponseAsync(note, cancellationToken);
    }

    /// <summary>Pins, unpins, archives or restores a note.</summary>
    /// <param name="userId">The owner.</param>
    /// <param name="noteId">The note.</param>
    /// <param name="request">The changes.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The updated note, or null when it does not exist or belongs to someone else.</returns>
    public async Task<NoteResponse?> PatchAsync(Guid userId, Guid noteId, PatchNoteRequest request, CancellationToken cancellationToken)
    {
        var note = await WithDetails(db.Notes).SingleOrDefaultAsync(n => n.Id == noteId && n.UserId == userId, cancellationToken);
        if (note is null)
        {
            return null;
        }

        if (request.IsPinned is { } pinned)
        {
            note.IsPinned = pinned;
        }

        if (request.IsArchived is { } archived)
        {
            note.ArchivedAtUtc = archived ? note.ArchivedAtUtc ?? time.GetUtcNow().UtcDateTime : null;
        }

        await db.SaveChangesAsync(cancellationToken);
        return await ToResponseAsync(note, cancellationToken);
    }

    /// <summary>Permanently deletes a note and its attachments.</summary>
    /// <param name="userId">The owner.</param>
    /// <param name="noteId">The note.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>False when the note does not exist or belongs to someone else.</returns>
    public async Task<bool> DeleteAsync(Guid userId, Guid noteId, CancellationToken cancellationToken)
    {
        var note = await db.Notes.Include(n => n.Attachments)
            .SingleOrDefaultAsync(n => n.Id == noteId && n.UserId == userId, cancellationToken);
        if (note is null)
        {
            return false;
        }

        var files = note.Attachments.Select(a => a.StorageKey).ToList();
        db.Notes.Remove(note);
        await db.SaveChangesAsync(cancellationToken);

        foreach (var storageKey in files)
        {
            store.Delete(storageKey);
        }

        await RemoveUnusedTagsAsync(userId, cancellationToken);
        return true;
    }

    /// <summary>Lists the user's tags with the number of active notes using each.</summary>
    /// <param name="userId">The owner.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>Named tags in alphabetical order, then end-to-end tags (tokens and encrypted names).</returns>
    public async Task<IReadOnlyList<TagResponse>> ListTagsAsync(Guid userId, CancellationToken cancellationToken)
    {
        var rows = await db.Tags
            .Where(t => t.UserId == userId)
            .Select(t => new
            {
                t.Name,
                t.Token,
                t.EncryptedName,
                Count = db.Notes.Count(n => n.UserId == userId && n.ArchivedAtUtc == null && n.Tags.Any(nt => nt.Id == t.Id)),
            })
            .Where(row => row.Count > 0)
            .OrderBy(row => row.Name == null)
            .ThenBy(row => row.Name)
            .ThenBy(row => row.Token)
            .ToListAsync(cancellationToken);
        return rows.Select(row => new TagResponse(row.Name, row.Count, row.Token, row.EncryptedName)).ToList();
    }

    /// <summary>
    /// Maps a loaded note, with its tags and attachments, to its API form: decrypted when the server encrypted it, as
    /// stored when the browser did.
    /// </summary>
    /// <param name="note">A note loaded with <c>Tags</c> and <c>Attachments</c>.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The API representation.</returns>
    internal async Task<NoteResponse> ToResponseAsync(Note note, CancellationToken cancellationToken)
    {
        var endToEnd = note.Scheme == ContentScheme.EndToEnd;
        return new(
            note.Id,
            endToEnd ? null : await ReadContentAsync(note, cancellationToken),
            note.IsPinned,
            note.ArchivedAtUtc is not null,
            note.CreatedAtUtc,
            note.UpdatedAtUtc,
            note.Tags.Where(t => t.Name is not null).Select(t => t.Name!).Order(StringComparer.Ordinal).ToList(),
            note.Attachments.OrderBy(a => a.CreatedAtUtc).Select(AttachmentResponse.From).ToList(),
            endToEnd ? note.Content : null);
    }

    /// <summary>Returns a note's text, decrypting it when necessary.</summary>
    /// <param name="note">The note.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The Markdown text, or <see cref="UnreadablePlaceholder"/> when the ciphertext is damaged.</returns>
    internal async Task<string> ReadContentAsync(Note note, CancellationToken cancellationToken)
    {
        if (note.Scheme == ContentScheme.None)
        {
            return Encoding.UTF8.GetString(note.Content);
        }

        if (note.Scheme == ContentScheme.EndToEnd)
        {
            return EndToEndPlaceholder;
        }

        try
        {
            return NoteCipher.Decrypt(await keys.GetKeyAsync(note.UserId, cancellationToken), note.UserId, note.Id, note.Content);
        }
        catch (CryptographicException ex)
        {
            logger.LogError(ex, "Note {NoteId} could not be decrypted.", note.Id);
            return UnreadablePlaceholder;
        }
    }

    private static IQueryable<Note> WithDetails(IQueryable<Note> notes) =>
        notes.Include(n => n.Attachments).Include(n => n.Tags).AsSplitQuery();

    private Task<List<Note>> LoadBatchAsync(
        Guid userId, NoteState state, TagFilter filter, NoteCursor? cursor, int count, CancellationToken cancellationToken)
    {
        var notes = db.Notes.AsNoTracking().Where(n => n.UserId == userId);
        notes = state switch
        {
            NoteState.Pinned => notes.Where(n => n.ArchivedAtUtc == null && n.IsPinned),
            NoteState.Active => notes.Where(n => n.ArchivedAtUtc == null),
            NoteState.Archived => notes.Where(n => n.ArchivedAtUtc != null),
            _ => notes.Where(n => n.ArchivedAtUtc == null && !n.IsPinned),
        };

        if (filter.IsActive)
        {
            var (tag, tokens) = (filter.Name, filter.Tokens);
            var nestedPrefix = tag + "/";
            notes = notes.Where(n => n.Tags.Any(t =>
                (tag != null && t.Name != null && (t.Name == tag || t.Name.StartsWith(nestedPrefix)))
                || (t.Token != null && tokens.Contains(t.Token))));
        }

        if (cursor is { } position)
        {
            notes = notes.Where(n => n.CreatedAtUtc < position.CreatedAtUtc
                || (n.CreatedAtUtc == position.CreatedAtUtc && n.Id.CompareTo(position.Id) < 0));
        }

        return WithDetails(notes)
            .OrderByDescending(n => n.CreatedAtUtc)
            .ThenByDescending(n => n.Id)
            .Take(count)
            .ToListAsync(cancellationToken);
    }

    private static bool Matches(NoteResponse note, string search) =>
        note.Content?.Contains(search, StringComparison.OrdinalIgnoreCase) == true
        || note.Attachments.Any(a => a.FileName?.Contains(search, StringComparison.OrdinalIgnoreCase) == true);

    private static string ValidateContent(string? content, int attachmentCount)
    {
        content ??= string.Empty;
        if (content.Length > MaxContentLength)
        {
            throw new ApiValidationException("content", $"A note can be at most {MaxContentLength:N0} characters long.");
        }

        if (string.IsNullOrWhiteSpace(content) && attachmentCount == 0)
        {
            throw new ApiValidationException("content", "Write something or attach a file.");
        }

        return content;
    }

    private async Task SetContentAsync(Note note, string content, CancellationToken cancellationToken)
    {
        var scheme = ContentSchemes.ForPlainText(await keys.GetModeAsync(note.UserId, cancellationToken));
        note.Content = scheme == ContentScheme.Server
            ? NoteCipher.Encrypt(await keys.GetKeyAsync(note.UserId, cancellationToken), note.UserId, note.Id, content)
            : Encoding.UTF8.GetBytes(content);
        note.Scheme = scheme;
    }

    private async Task RequireEndToEndAsync(Guid userId, CancellationToken cancellationToken)
    {
        if (await keys.GetModeAsync(userId, cancellationToken) != EncryptionMode.EndToEnd)
        {
            throw new ApiProblemException(
                StatusCodes.Status409Conflict,
                "This account does not use end-to-end encryption.",
                "Send the note as plain text; the server protects it according to the account's settings.");
        }
    }

    private static void SetEncryptedContent(Note note, EncryptedNote encrypted)
    {
        if (!EndToEndContent.IsEnvelope(encrypted.Content, EndToEndContent.MaxNoteEnvelopeBytes))
        {
            throw new ApiValidationException("encrypted.content", "This is not encrypted note text.");
        }

        note.Content = encrypted.Content;
        note.Scheme = ContentScheme.EndToEnd;
    }

    private async Task SetEncryptedTagsAsync(Note note, IReadOnlyList<EncryptedTag>? tags, CancellationToken cancellationToken)
    {
        tags ??= [];
        if (tags.Count > EndToEndContent.MaxTagsPerNote
            || !tags.All(t => EndToEndContent.IsTagToken(t.Token) && EndToEndContent.IsEnvelope(t.Name, EndToEndContent.MaxTagNameEnvelopeBytes)))
        {
            throw new ApiValidationException("encrypted.tags", "Each tag needs a 22-character token and an encrypted name, at most 100 per note.");
        }

        var tokens = tags.Select(t => t.Token).Distinct().ToList();
        var existing = tokens.Count == 0
            ? []
            : await db.Tags.Where(t => t.UserId == note.UserId && t.Token != null && tokens.Contains(t.Token)).ToListAsync(cancellationToken);

        note.Tags.Clear();
        foreach (var encrypted in tags.DistinctBy(t => t.Token))
        {
            var tag = existing.FirstOrDefault(t => t.Token == encrypted.Token);
            if (tag is null)
            {
                tag = new Tag { UserId = note.UserId, Token = encrypted.Token, EncryptedName = encrypted.Name };
                db.Tags.Add(tag);
            }

            note.Tags.Add(tag);
        }
    }

    private async Task AttachAsync(Note note, IReadOnlyCollection<Guid> attachmentIds, CancellationToken cancellationToken)
    {
        if (attachmentIds.Count == 0)
        {
            return;
        }

        var ids = attachmentIds.Distinct().ToList();
        var uploads = await db.Attachments
            .Where(a => ids.Contains(a.Id) && a.UserId == note.UserId && a.NoteId == null)
            .ToListAsync(cancellationToken);
        if (uploads.Count != ids.Count)
        {
            throw new ApiValidationException("attachmentIds", "One or more files do not exist or are already attached to another note.");
        }

        note.Attachments.AddRange(uploads);
    }

    private async Task SetTagsAsync(Note note, string content, CancellationToken cancellationToken)
    {
        var names = TagParser.Extract(content);
        var existing = names.Count == 0
            ? []
            : await db.Tags.Where(t => t.UserId == note.UserId && t.Name != null && names.Contains(t.Name)).ToListAsync(cancellationToken);

        note.Tags.Clear();
        foreach (var name in names)
        {
            var tag = existing.FirstOrDefault(t => t.Name == name);
            if (tag is null)
            {
                // Added explicitly: the ID is generated client-side, so EF would otherwise assume the tag already
                // exists when it discovers it through an already-tracked note.
                tag = new Tag { UserId = note.UserId, Name = name };
                db.Tags.Add(tag);
            }

            note.Tags.Add(tag);
        }
    }

    private Task RemoveUnusedTagsAsync(Guid userId, CancellationToken cancellationToken) =>
        db.Tags
            .Where(t => t.UserId == userId && !db.Notes.Any(n => n.UserId == userId && n.Tags.Any(nt => nt.Id == t.Id)))
            .ExecuteDeleteAsync(cancellationToken);

    /// <summary>A tag filter: a tag name (plain-text notes) and blind tokens (end-to-end notes), matched with OR.</summary>
    private readonly record struct TagFilter(string? Name, string[] Tokens)
    {
        public bool IsActive => Name is not null || Tokens.Length > 0;
    }
}
