using System.Globalization;
using System.Text.RegularExpressions;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Features.Push;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Reminders;

/// <summary>Sets a note's reminder.</summary>
/// <param name="At">The local date and time, <c>yyyy-MM-ddTHH:mm</c>.</param>
/// <param name="TimeZone">The IANA time zone it is in (the one the app shows days in).</param>
/// <param name="Repeat">How it repeats.</param>
public sealed record SetReminderRequest(string? At, string? TimeZone, ReminderRepeat Repeat = ReminderRepeat.None);

/// <summary>A note's reminder.</summary>
/// <param name="NoteId">The note.</param>
/// <param name="At">The local date and time it was set for, <c>yyyy-MM-ddTHH:mm</c>.</param>
/// <param name="TimeZone">Its time zone.</param>
/// <param name="Repeat">How it repeats.</param>
/// <param name="NextAtUtc">When it next goes off.</param>
/// <param name="LastSentAtUtc">When it last went off.</param>
public sealed record ReminderResponse(Guid NoteId, string At, string TimeZone, ReminderRepeat Repeat, DateTime NextAtUtc, DateTime? LastSentAtUtc);

/// <summary>What setting a reminder did.</summary>
public enum SetReminderResult
{
    /// <summary>Saved.</summary>
    Saved,

    /// <summary>No such note for this account (or it is in the trash).</summary>
    NotFound,
}

/// <summary>Reminders on notes: setting, listing, and sending the ones that are due as push notifications.</summary>
public sealed partial class ReminderService(
    MapleDbContext db, NoteService notes, PushService push, TimeProvider time, ILogger<ReminderService> logger)
{
    /// <summary>A reminder more than this late (the server was off) is not sent; a repeating one moves on.</summary>
    public static readonly TimeSpan MaxLateness = TimeSpan.FromHours(12);

    /// <summary>Text shown for end-to-end notes, which the server cannot read.</summary>
    public const string PrivateNoteText = "Open Maple Notes to see the note.";

    /// <summary>Sets or replaces a note's reminder.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="noteId">The note.</param>
    /// <param name="request">When, and how it repeats.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The result, and the reminder when saved.</returns>
    /// <exception cref="ApiValidationException">The time, zone or repeat is invalid, the note is not a note, or a one-off time has passed.</exception>
    public async Task<(SetReminderResult Result, ReminderResponse? Reminder)> SetAsync(
        Guid userId, Guid noteId, SetReminderRequest request, CancellationToken cancellationToken)
    {
        if (!DateTime.TryParseExact(request.At?.Trim(), ["yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd'T'HH:mm:ss"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var local))
        {
            throw new ApiValidationException("at", "Give a local date and time as yyyy-MM-ddTHH:mm.");
        }

        var zoneId = request.TimeZone?.Trim() ?? "";
        if (zoneId.Length is 0 or > 64 || !TimeZoneInfo.TryFindSystemTimeZoneById(zoneId, out var zone) || !zone.HasIanaId)
        {
            throw new ApiValidationException("timeZone", "Give an IANA time zone such as Europe/Paris.");
        }

        if (!Enum.IsDefined(request.Repeat))
        {
            throw new ApiValidationException("repeat", $"Choose one of: {string.Join(", ", Enum.GetNames<ReminderRepeat>())}.");
        }

        var note = await db.Notes.AsNoTracking().Where(n => n.Id == noteId && n.UserId == userId && n.TrashedAtUtc == null)
            .Select(n => new { n.Kind }).SingleOrDefaultAsync(cancellationToken);
        if (note is null)
        {
            return (SetReminderResult.NotFound, null);
        }

        if (note.Kind is not (NoteKind.Note or NoteKind.Quick))
        {
            throw new ApiValidationException("noteId", "Reminders can be set on notes and quick notes.");
        }

        local = new DateTime(local.Year, local.Month, local.Day, local.Hour, local.Minute, 0, DateTimeKind.Unspecified);
        var now = time.GetUtcNow().UtcDateTime;
        if (ReminderSchedule.Next(local, zone, request.Repeat, now) is not { } next)
        {
            throw new ApiValidationException("at", "That time has passed. Choose a time in the future.");
        }

        var reminder = await db.NoteReminders.SingleOrDefaultAsync(r => r.NoteId == noteId, cancellationToken);
        if (reminder is null)
        {
            reminder = new NoteReminder { NoteId = noteId, UserId = userId, TimeZone = zoneId };
            db.NoteReminders.Add(reminder);
        }

        (reminder.StartLocal, reminder.TimeZone, reminder.Repeat, reminder.NextAtUtc, reminder.LastSentAtUtc) =
            (local, zoneId, request.Repeat, next, null);
        await db.SaveChangesAsync(cancellationToken);
        return (SetReminderResult.Saved, ToResponse(reminder));
    }

    /// <summary>Removes a note's reminder.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="noteId">The note.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>False when the note had none.</returns>
    public async Task<bool> RemoveAsync(Guid userId, Guid noteId, CancellationToken cancellationToken) =>
        await db.NoteReminders.Where(r => r.NoteId == noteId && r.UserId == userId).ExecuteDeleteAsync(cancellationToken) > 0;

    /// <summary>The account's reminders on notes that are neither archived nor in the trash, soonest first.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The reminders.</returns>
    public async Task<IReadOnlyList<ReminderResponse>> ListAsync(Guid userId, CancellationToken cancellationToken)
    {
        var reminders = await db.NoteReminders.AsNoTracking()
            .Where(r => r.UserId == userId && db.Notes.Any(n => n.Id == r.NoteId && n.TrashedAtUtc == null && n.ArchivedAtUtc == null))
            .OrderBy(r => r.NextAtUtc)
            .ToListAsync(cancellationToken);
        return reminders.Select(ToResponse).ToList();
    }

    /// <summary>
    /// Sends every reminder that is due and moves it on: a repeating one to its next time, a one-off one is removed.
    /// Reminders on archived notes or notes in the trash, and ones more than <see cref="MaxLateness"/> late, are not
    /// sent but move on the same way.
    /// </summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>How many notifications reached a device.</returns>
    public async Task<int> SendDueAsync(CancellationToken cancellationToken)
    {
        var sent = 0;
        while (true)
        {
            var now = time.GetUtcNow().UtcDateTime;
            var due = await db.NoteReminders.Where(r => r.NextAtUtc <= now).OrderBy(r => r.NextAtUtc).Take(50).ToListAsync(cancellationToken);
            if (due.Count == 0)
            {
                return sent;
            }

            foreach (var reminder in due)
            {
                var note = await notes.GetAsync(reminder.UserId, reminder.NoteId, cancellationToken);
                if (note is { IsArchived: false } && now - reminder.NextAtUtc <= MaxLateness
                    && await db.Notes.AnyAsync(n => n.Id == reminder.NoteId && n.TrashedAtUtc == null, cancellationToken))
                {
                    var text = note.Content is null ? PrivateNoteText : FirstLine(note.Content);
                    sent += await push.SendToAccountAsync(
                        reminder.UserId, new PushMessage("Reminder", text, reminder.NoteId, $"reminder-{reminder.NoteId}"), cancellationToken);
                    reminder.LastSentAtUtc = now;
                }

                var zone = TimeZoneInfo.TryFindSystemTimeZoneById(reminder.TimeZone, out var found) ? found : TimeZoneInfo.Utc;
                if (ReminderSchedule.Next(reminder.StartLocal, zone, reminder.Repeat, now) is { } next)
                {
                    reminder.NextAtUtc = next;
                }
                else
                {
                    db.NoteReminders.Remove(reminder);
                }

                await db.SaveChangesAsync(cancellationToken);
            }

            logger.LogDebug("Sent {Count} reminder(s)", due.Count);
        }
    }

    /// <summary>The note's first line with text, without Markdown marks, at most 140 characters.</summary>
    /// <param name="content">The note's Markdown.</param>
    /// <returns>The line, or "A note" when it has no text.</returns>
    public static string FirstLine(string content)
    {
        var line = content.Split('\n').Select(l => MarkdownMarks().Replace(l, "").Trim()).FirstOrDefault(l => l.Length > 0) ?? "";
        line = line.Replace("**", "", StringComparison.Ordinal).Replace("__", "", StringComparison.Ordinal).Replace("`", "", StringComparison.Ordinal);
        return line.Length == 0 ? "A note" : line.Length <= 140 ? line : line[..139] + "…";
    }

    private static ReminderResponse ToResponse(NoteReminder r) =>
        new(r.NoteId, r.StartLocal.ToString("yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture), r.TimeZone, r.Repeat, r.NextAtUtc, r.LastSentAtUtc);

    /// <summary>Leading heading, quote, list and task marks.</summary>
    [GeneratedRegex(@"^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)*")]
    private static partial Regex MarkdownMarks();
}

/// <summary>Sends reminders that are due: at startup, then every 30 seconds.</summary>
internal sealed class ReminderSenderService(IServiceScopeFactory scopes, ILogger<ReminderSenderService> logger) : BackgroundService
{
    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<ReminderService>().SendDueAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Sending reminders failed; it will be retried shortly.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
