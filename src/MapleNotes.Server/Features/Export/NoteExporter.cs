using System.Globalization;
using System.IO.Compression;
using System.IO.Pipelines;
using System.Security.Cryptography;
using System.Text;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Export;

/// <summary>Validated export options.</summary>
/// <param name="Format">File format of the notes.</param>
/// <param name="Layout">Folder layout.</param>
/// <param name="IncludeArchived">Whether archived notes are included.</param>
/// <param name="IncludeAttachments">Whether attached files are included.</param>
/// <param name="From">First creation date included (inclusive), in <paramref name="TimeZone"/>.</param>
/// <param name="To">Last creation date included (inclusive), in <paramref name="TimeZone"/>.</param>
/// <param name="TimeZone">Time zone for folder names, file names and timestamps.</param>
public sealed record ExportOptions(
    ExportFormat Format,
    ExportLayout Layout,
    bool IncludeArchived,
    bool IncludeAttachments,
    DateOnly? From,
    DateOnly? To,
    TimeZoneInfo TimeZone);

/// <summary>
/// Writes a user's notes, decrypted, as a ZIP archive streamed straight to the response.
/// </summary>
/// <remarks>
/// <para>Archive layout (with the monthly layout and Markdown):</para>
/// <code>
/// manifest.json                                   what was exported, with every note's path
/// 2026-09/2026-09-28_1430_buy-maple-syrup.md      one file per note
/// attachments/5d1e0a7c_sunset.png                 decrypted attached files
/// </code>
/// <para>
/// Notes link their attachments by relative path (<c>../attachments/…</c>), so links keep working wherever the
/// archive is extracted. The archive is written with asynchronous ZIP APIs directly into the response body: nothing
/// is buffered whole and decrypted content never touches the disk. Notes are read in batches, so memory use does not
/// grow with the size of the account. An attachment that cannot be read is left out (or, if damage is found part-way,
/// kept incomplete) and listed under <c>problems</c> in the manifest, instead of failing the whole export.
/// </para>
/// </remarks>
/// <param name="db">Database context.</param>
/// <param name="notes">Decrypts note text.</param>
/// <param name="attachments">Opens decrypted attachment content.</param>
/// <param name="time">Clock.</param>
/// <param name="logger">Logger.</param>
public sealed class NoteExporter(
    MapleDbContext db, NoteService notes, AttachmentService attachments, TimeProvider time, ILogger<NoteExporter> logger)
{
    private const int BatchSize = 200;

    /// <summary>Validates export options before anything is written.</summary>
    /// <param name="request">The requested options.</param>
    /// <returns>The validated options.</returns>
    /// <exception cref="ApiValidationException">The time zone is unknown or the date range is reversed.</exception>
    public static ExportOptions Validate(ExportRequest request)
    {
        var timeZone = TimeZoneInfo.Utc;
        if (!string.IsNullOrWhiteSpace(request.TimeZone) && !TimeZoneInfo.TryFindSystemTimeZoneById(request.TimeZone.Trim(), out timeZone))
        {
            throw new ApiValidationException("timeZone", $"Unknown time zone '{request.TimeZone}'. Use an IANA name such as Europe/Paris.");
        }

        if (request.From > request.To)
        {
            throw new ApiValidationException("from", "The start date must not be after the end date.");
        }

        return new ExportOptions(request.Format, request.Layout, request.IncludeArchived, request.IncludeAttachments,
            request.From, request.To, timeZone!);
    }

    /// <summary>
    /// Whether the account has content the server cannot decrypt (end-to-end encrypted). Such an account is exported
    /// by the web app, which builds the same archive in the browser.
    /// </summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>True when a note or attachment is end-to-end encrypted.</returns>
    public async Task<bool> HasEndToEndContentAsync(Guid userId, CancellationToken cancellationToken) =>
        await db.Notes.AnyAsync(n => n.UserId == userId && n.Scheme == ContentScheme.EndToEnd, cancellationToken)
        || await db.Attachments.AnyAsync(a => a.UserId == userId && a.Scheme == ContentScheme.EndToEnd, cancellationToken);

    /// <summary>The download's file name, e.g. <c>maple-notes-2026-09-28.zip</c>.</summary>
    /// <param name="options">The export options (for the time zone).</param>
    /// <returns>The file name.</returns>
    public string FileName(ExportOptions options) =>
        $"maple-notes-{TimeZoneInfo.ConvertTime(time.GetUtcNow(), options.TimeZone).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}.zip";

    /// <summary>Streams the archive to an HTTP response body.</summary>
    /// <remarks>
    /// <see cref="ZipArchive"/> still performs some synchronous writes internally (for example when it finishes an
    /// entry on a non-seekable stream), and ASP.NET Core forbids synchronous I/O on the response. The archive is
    /// therefore written into a bounded in-memory pipe by a background task while the request copies the pipe to the
    /// response asynchronously. The pipe's threshold applies backpressure, so memory use stays around 1 MB however
    /// large the export is.
    /// </remarks>
    /// <param name="userId">Whose notes to export.</param>
    /// <param name="options">Validated options.</param>
    /// <param name="output">The response body.</param>
    /// <param name="cancellationToken">Cancels the export (for example when the download is aborted).</param>
    /// <returns>A task that completes when the archive has been sent.</returns>
    public async Task StreamAsync(Guid userId, ExportOptions options, Stream output, CancellationToken cancellationToken)
    {
        var pipe = new Pipe(new PipeOptions(pauseWriterThreshold: 1024 * 1024, resumeWriterThreshold: 512 * 1024, useSynchronizationContext: false));
        var producer = Task.Run(async () =>
        {
            Exception? failure = null;
            try
            {
                await using var zipOutput = pipe.Writer.AsStream(leaveOpen: true);
                await WriteAsync(userId, options, zipOutput, cancellationToken);
            }
            catch (Exception ex)
            {
                failure = ex;
            }
            finally
            {
                await pipe.Writer.CompleteAsync(failure);
            }
        }, CancellationToken.None);

        try
        {
            await pipe.Reader.CopyToAsync(output, cancellationToken);
        }
        finally
        {
            await pipe.Reader.CompleteAsync();
            await producer;
        }
    }

    /// <summary>Writes the archive.</summary>
    /// <param name="userId">Whose notes to export.</param>
    /// <param name="options">Validated options.</param>
    /// <param name="output">Destination stream; need not be seekable.</param>
    /// <param name="cancellationToken">Cancels the export (for example when the download is aborted).</param>
    /// <returns>A task that completes when the archive is fully written.</returns>
    public async Task WriteAsync(Guid userId, ExportOptions options, Stream output, CancellationToken cancellationToken)
    {
        var username = await db.Users.Where(u => u.Id == userId).Select(u => u.Username).SingleAsync(cancellationToken);
        var exportedAt = TimeZoneInfo.ConvertTime(time.GetUtcNow(), options.TimeZone);
        var usedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "manifest.json" };
        var problems = new List<string>();
        var manifestNotes = new List<object>();
        var attachmentCount = 0;

        await using (var zip = await ZipArchive.CreateAsync(output, ZipArchiveMode.Create, leaveOpen: true, entryNameEncoding: null, cancellationToken))
        {
            (DateTime CreatedAtUtc, Guid Id)? after = null;
            while (true)
            {
                var batch = await LoadBatchAsync(userId, options, after, cancellationToken);
                foreach (var note in batch)
                {
                    var (path, exported) = await WriteNoteAsync(zip, note, options, usedPaths, problems, cancellationToken);
                    attachmentCount += exported.Attachments.Count;
                    manifestNotes.Add(new
                    {
                        exported.Id,
                        Path = path,
                        CreatedAt = exported.Created.ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture),
                        exported.Tags,
                        exported.Archived,
                        Attachments = exported.Attachments.Select(a => a.ArchivePath),
                    });
                }

                if (batch.Count < BatchSize)
                {
                    break;
                }

                after = (batch[^1].CreatedAtUtc, batch[^1].Id);
            }

            var manifest = new
            {
                Application = "Maple Notes",
                ManifestVersion = 1,
                ExportedAt = exportedAt.ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture),
                Account = username,
                Options = new
                {
                    Format = options.Format.ToString().ToLowerInvariant(),
                    Layout = options.Layout.ToString().ToLowerInvariant(),
                    TimeZone = options.TimeZone.Id,
                    options.IncludeArchived,
                    options.IncludeAttachments,
                    From = options.From?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    To = options.To?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                },
                NoteCount = manifestNotes.Count,
                AttachmentCount = attachmentCount,
                Problems = problems,
                Notes = manifestNotes,
            };
            await WriteTextAsync(zip, "manifest.json", NoteFormatter.ManifestJson(manifest), exportedAt, cancellationToken);
        }

        await output.FlushAsync(cancellationToken);
    }

    private Task<List<Note>> LoadBatchAsync(
        Guid userId, ExportOptions options, (DateTime CreatedAtUtc, Guid Id)? after, CancellationToken cancellationToken)
    {
        var query = db.Notes.AsNoTracking().Where(n => n.UserId == userId);
        if (!options.IncludeArchived)
        {
            query = query.Where(n => n.ArchivedAtUtc == null);
        }

        if (options.From is { } from)
        {
            var fromUtc = StartOfDayUtc(from, options.TimeZone);
            query = query.Where(n => n.CreatedAtUtc >= fromUtc);
        }

        if (options.To is { } to)
        {
            var endUtc = StartOfDayUtc(to.AddDays(1), options.TimeZone);
            query = query.Where(n => n.CreatedAtUtc < endUtc);
        }

        if (after is { } position)
        {
            var afterTime = position.CreatedAtUtc;
            var afterId = position.Id;
            query = query.Where(n => n.CreatedAtUtc > afterTime || (n.CreatedAtUtc == afterTime && n.Id.CompareTo(afterId) > 0));
        }

        return query
            .Include(n => n.Attachments)
            .Include(n => n.Tags)
            .AsSplitQuery()
            .OrderBy(n => n.CreatedAtUtc)
            .ThenBy(n => n.Id)
            .Take(BatchSize)
            .ToListAsync(cancellationToken);
    }

    private async Task<(string Path, ExportedNote Note)> WriteNoteAsync(
        ZipArchive zip, Note note, ExportOptions options, ISet<string> usedPaths, List<string> problems, CancellationToken cancellationToken)
    {
        var content = await notes.ReadContentAsync(note, cancellationToken);
        var created = TimeZoneInfo.ConvertTime(new DateTimeOffset(note.CreatedAtUtc), options.TimeZone);
        var updated = TimeZoneInfo.ConvertTime(new DateTimeOffset(note.UpdatedAtUtc), options.TimeZone);

        var folder = ExportNaming.Folder(options.Layout, created);
        var name = $"{created.ToString("yyyy-MM-dd_HHmm", CultureInfo.InvariantCulture)}_{ExportNaming.Slug(content)}.{NoteFormatter.Extension(options.Format)}";
        var notePath = ExportNaming.Unique(folder.Length == 0 ? name : $"{folder}/{name}", usedPaths);

        var exportedAttachments = new List<ExportedAttachment>();
        if (options.IncludeAttachments)
        {
            foreach (var attachment in note.Attachments.OrderBy(a => a.CreatedAtUtc))
            {
                var archivePath = ExportNaming.Unique(
                    $"attachments/{attachment.Id.ToString("N")[^8..]}_{ExportNaming.SafeFileName(attachment.FileName)}", usedPaths);
                if (await WriteAttachmentAsync(zip, attachment, archivePath, options.TimeZone, problems, cancellationToken))
                {
                    exportedAttachments.Add(new ExportedAttachment(
                        attachment.FileName, attachment.ContentType, attachment.SizeBytes, UploadPolicy.IsImage(attachment.ContentType),
                        archivePath, ExportNaming.RelativePath(notePath, archivePath)));
                }
            }
        }

        var exported = new ExportedNote(
            note.Id, content, created, updated,
            note.Tags.Where(t => t.Name is not null).Select(t => t.Name!).Order(StringComparer.Ordinal).ToList(),
            note.IsPinned, note.ArchivedAtUtc is not null, exportedAttachments);
        await WriteTextAsync(zip, notePath, NoteFormatter.Render(exported, options.Format), updated, cancellationToken);
        return (notePath, exported);
    }

    private async Task<bool> WriteAttachmentAsync(
        ZipArchive zip, Attachment attachment, string archivePath, TimeZoneInfo timeZone, List<string> problems, CancellationToken cancellationToken)
    {
        Stream source;
        try
        {
            source = await attachments.OpenContentAsync(attachment, cancellationToken);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or CryptographicException)
        {
            logger.LogWarning(ex, "Attachment {AttachmentId} could not be read and was left out of an export.", attachment.Id);
            problems.Add($"{archivePath}: the stored file could not be read, so it was left out.");
            return false;
        }

        await using (source)
        {
            var entry = zip.CreateEntry(archivePath, CompressionFor(attachment.ContentType));
            entry.LastWriteTime = TimeZoneInfo.ConvertTime(new DateTimeOffset(attachment.CreatedAtUtc), timeZone);
            await using var target = await entry.OpenAsync(cancellationToken);
            try
            {
                await source.CopyToAsync(target, cancellationToken);
            }
            catch (CryptographicException ex)
            {
                logger.LogWarning(ex, "Attachment {AttachmentId} is damaged; its exported copy is incomplete.", attachment.Id);
                problems.Add($"{archivePath}: the stored file is damaged, so this copy is incomplete.");
            }
        }

        return true;
    }

    private static async Task WriteTextAsync(ZipArchive zip, string path, string text, DateTimeOffset lastWrite, CancellationToken cancellationToken)
    {
        var entry = zip.CreateEntry(path, CompressionLevel.Optimal);
        entry.LastWriteTime = lastWrite;
        await using var stream = await entry.OpenAsync(cancellationToken);
        await stream.WriteAsync(Encoding.UTF8.GetBytes(text), cancellationToken);
    }

    // Media and archives are already compressed; compressing them again only costs time.
    private static CompressionLevel CompressionFor(string contentType) =>
        contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) && contentType != "image/svg+xml"
        || contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase)
        || contentType.StartsWith("audio/", StringComparison.OrdinalIgnoreCase)
        || contentType is "application/zip" or "application/gzip" or "application/x-7z-compressed" or "application/pdf"
            ? CompressionLevel.NoCompression
            : CompressionLevel.Fastest;

    private static DateTime StartOfDayUtc(DateOnly date, TimeZoneInfo timeZone)
    {
        var local = date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);
        while (timeZone.IsInvalidTime(local))
        {
            local = local.AddMinutes(30); // midnight skipped by a daylight-saving change in this zone
        }

        return TimeZoneInfo.ConvertTimeToUtc(local, timeZone);
    }
}
