using System.Security.Cryptography;
using System.Text.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Audit;

/// <summary>Which entries to list.</summary>
public enum AuditFilter
{
    /// <summary>Everything.</summary>
    All,

    /// <summary>Sign-ins, made or refused.</summary>
    SignIns,

    /// <summary>Refused sign-ins only.</summary>
    FailedSignIns,

    /// <summary>Administrators' actions only.</summary>
    Admin,

    /// <summary>Changes people made to their own password, two-factor sign-in, passkeys, recovery key or encryption.</summary>
    Security,
}

/// <summary>One entry, as the API returns it.</summary>
/// <param name="Id">Its number; pass the last one as <c>before</c> for the next page.</param>
/// <param name="AtUtc">When it happened.</param>
/// <param name="Event">What happened.</param>
/// <param name="Username">Who signed in, tried to, or acted (empty for an unknown passkey).</param>
/// <param name="TargetUsername">The account an administrator changed or deleted.</param>
/// <param name="Method"><c>Password</c> or <c>Passkey</c>, for sign-ins.</param>
/// <param name="Detail">What was refused or changed.</param>
/// <param name="IpAddress">Where the request came from.</param>
public sealed record AuditEntryResponse(
    long Id, DateTime AtUtc, AuditEvent Event, string Username, string? TargetUsername, string? Method, string Detail, string? IpAddress);

/// <summary>A page of entries, newest first.</summary>
/// <param name="Items">The entries.</param>
/// <param name="NextCursor">The <c>before</c> for the next page, or null at the end.</param>
public sealed record AuditPageResponse(IReadOnlyList<AuditEntryResponse> Items, long? NextCursor);

/// <summary>The result of checking the audit log's hash chain.</summary>
/// <param name="Intact">Whether every covered entry is unchanged and none is missing in between.</param>
/// <param name="CheckedEntries">How many entries the chain covers and were checked.</param>
/// <param name="UncoveredEntries">Entries written before the chain started (before version 1.22), which it cannot vouch for.</param>
/// <param name="FirstBrokenId">The first entry whose link does not match: it was edited, or an entry before it was deleted.</param>
/// <param name="Problem">What is wrong, in a sentence; null when intact.</param>
/// <param name="StartedAtUtc">When the chain started; null before the first entry is written.</param>
/// <param name="PrunedThroughId">The newest entry deleted after the retention period, or 0.</param>
public sealed record AuditVerifyResponse(
    bool Intact, int CheckedEntries, int UncoveredEntries, long? FirstBrokenId, string? Problem, DateTime? StartedAtUtc, long PrunedThroughId);

/// <summary>
/// Writes, lists, verifies and prunes the audit log: sign-ins, people's changes to their own sign-in and encryption,
/// and administrators' actions. Entries are hash-chained (see <see cref="AuditChain"/>).
/// </summary>
public sealed class AuditLog(
    MapleDbContext db, TimeProvider time, IHttpContextAccessor http, KeyMaterial keys, MapleOptions options, AuditStdout stdout)
{
    /// <summary>Most entries in one page.</summary>
    public const int MaxPageSize = 100;

    private const int VerifyBatchSize = 1000;

    private static readonly JsonSerializerOptions StdoutJson = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Serialises writes and pruning, so each entry links to the one written just before it. The server is a single
    /// process with one SQLite database, so a process-wide lock is enough.
    /// </summary>
    private static readonly SemaphoreSlim ChainLock = new(1, 1);

    private static readonly AuditEvent[] AdminEvents = [AuditEvent.SettingsChanged, AuditEvent.AccountChanged, AuditEvent.AccountDeleted];

    /// <summary>Records a sign-in, a refused sign-in, or an administrator's action, with the request's address.</summary>
    /// <param name="event">What happened.</param>
    /// <param name="username">Who signed in, tried to, or acted.</param>
    /// <param name="detail">What was refused or changed.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <param name="target">The account an administrator changed or deleted.</param>
    /// <param name="method">How a sign-in was made.</param>
    /// <returns>A task that completes once the entry is saved.</returns>
    public async Task RecordAsync(
        AuditEvent @event, string? username, string detail, CancellationToken cancellationToken, string? target = null, string? method = null)
    {
        var entry = new AuditEntry
        {
            AtUtc = time.GetUtcNow().UtcDateTime,
            Event = @event,
            Username = Clean(username, AuditEntry.MaxUsernameLength),
            TargetUsername = target is null ? null : Clean(target, AuditEntry.MaxUsernameLength),
            Method = method,
            Detail = Clean(detail, AuditEntry.MaxDetailLength),
            IpAddress = http.HttpContext?.Connection.RemoteIpAddress?.ToString(),
        };

        await ChainLock.WaitAsync(cancellationToken);
        try
        {
            var anchor = await EnsureAnchorAsync(cancellationToken);
            var previous = anchor is null
                ? await db.AuditEntries.AsNoTracking().OrderByDescending(e => e.Id).Select(e => e.Hash).FirstOrDefaultAsync(cancellationToken)
                : await db.AuditEntries.AsNoTracking().Where(e => e.Id > anchor.LegacyThroughId)
                    .OrderByDescending(e => e.Id).Select(e => e.Hash).FirstOrDefaultAsync(cancellationToken) ?? anchor.Hash;
            entry.Hash = AuditChain.HashEntry(keys.AuditKey, previous ?? AuditChain.Genesis, entry);
            db.AuditEntries.Add(entry);
            await db.SaveChangesAsync(cancellationToken);
            if (options.AuditStdout)
            {
                WriteLine(entry);
            }
        }
        finally
        {
            ChainLock.Release();
        }
    }

    /// <summary>Lists entries newest first, a page at a time.</summary>
    /// <param name="filter">Which entries.</param>
    /// <param name="before">Only entries older than this one (the previous page's cursor).</param>
    /// <param name="limit">Page size, 1 to <see cref="MaxPageSize"/>.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The page.</returns>
    public async Task<AuditPageResponse> ListAsync(AuditFilter filter, long? before, int limit, CancellationToken cancellationToken)
    {
        limit = Math.Clamp(limit, 1, MaxPageSize);
        var query = db.AuditEntries.AsNoTracking();
        query = filter switch
        {
            AuditFilter.SignIns => query.Where(e => e.Event == AuditEvent.SignIn || e.Event == AuditEvent.SignInFailed),
            AuditFilter.FailedSignIns => query.Where(e => e.Event == AuditEvent.SignInFailed),
            AuditFilter.Admin => query.Where(e => AdminEvents.Contains(e.Event)),
            AuditFilter.Security => query.Where(e => e.Event != AuditEvent.SignIn && e.Event != AuditEvent.SignInFailed && !AdminEvents.Contains(e.Event)),
            _ => query,
        };
        if (before is { } cursor)
        {
            query = query.Where(e => e.Id < cursor);
        }

        var items = await query.OrderByDescending(e => e.Id).Take(limit + 1)
            .Select(e => new AuditEntryResponse(e.Id, e.AtUtc, e.Event, e.Username, e.TargetUsername, e.Method, e.Detail, e.IpAddress))
            .ToListAsync(cancellationToken);
        return items.Count > limit ? new(items[..limit], items[limit - 1].Id) : new(items, null);
    }

    /// <summary>
    /// Checks the hash chain from the anchor to the newest entry and reports the first entry whose link does not match.
    /// </summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The result.</returns>
    public async Task<AuditVerifyResponse> VerifyAsync(CancellationToken cancellationToken)
    {
        var anchor = await db.AuditChainAnchors.AsNoTracking().SingleOrDefaultAsync(cancellationToken);
        var firstId = await db.AuditEntries.AsNoTracking().OrderBy(e => e.Id).Select(e => (long?)e.Id).FirstOrDefaultAsync(cancellationToken);
        if (anchor is null)
        {
            return firstId is { } id
                ? new(false, 0, 0, id, "The start of the chain is missing from the database.", null, 0)
                : new(true, 0, 0, null, null, null, 0);
        }

        if (!CryptographicOperations.FixedTimeEquals(anchor.Mac, AuditChain.SealAnchor(keys.AuditKey, anchor)))
        {
            return new(false, 0, 0, firstId, "The start of the chain was changed in the database.", anchor.StartedAtUtc, anchor.PrunedThroughId);
        }

        var previous = anchor.Hash;
        int covered = 0, uncovered = 0;
        long after = 0;
        while (true)
        {
            var batch = await db.AuditEntries.AsNoTracking().Where(e => e.Id > after).OrderBy(e => e.Id).Take(VerifyBatchSize)
                .ToListAsync(cancellationToken);
            foreach (var entry in batch)
            {
                if (entry.Id <= anchor.LegacyThroughId && entry.Hash is null)
                {
                    uncovered++;
                    continue;
                }

                if (entry.Id <= anchor.PrunedThroughId
                    || entry.Hash is null
                    || !CryptographicOperations.FixedTimeEquals(entry.Hash, AuditChain.HashEntry(keys.AuditKey, previous, entry)))
                {
                    return new(false, covered, uncovered, entry.Id,
                        "This entry was changed, or an entry just before it was deleted.", anchor.StartedAtUtc, anchor.PrunedThroughId);
                }

                previous = entry.Hash;
                covered++;
            }

            if (batch.Count < VerifyBatchSize)
            {
                return new(true, covered, uncovered, null, null, anchor.StartedAtUtc, anchor.PrunedThroughId);
            }

            after = batch[^1].Id;
        }
    }

    /// <summary>
    /// Deletes entries older than <see cref="AuditEntry.RetentionDays"/> and moves the chain's anchor to the last one
    /// deleted, so the oldest kept entry still verifies.
    /// </summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>How many were deleted.</returns>
    public async Task<int> PruneAsync(CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var cutoff = now.AddDays(-AuditEntry.RetentionDays);
        await ChainLock.WaitAsync(cancellationToken);
        try
        {
            // Delete only the run of old entries at the start of the log, never a hole in the middle (which would look
            // like tampering), even if a clock change left an older time after a newer one.
            var firstKept = await db.AuditEntries.AsNoTracking().Where(e => e.AtUtc >= cutoff).MinAsync(e => (long?)e.Id, cancellationToken);
            var last = await db.AuditEntries.AsNoTracking().Where(e => e.AtUtc < cutoff && (firstKept == null || e.Id < firstKept))
                .OrderByDescending(e => e.Id).Select(e => new { e.Id, e.Hash }).FirstOrDefaultAsync(cancellationToken);
            if (last is null)
            {
                return 0;
            }

            await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
            var anchor = await EnsureAnchorAsync(cancellationToken);
            if (anchor is not null)
            {
                anchor.PrunedThroughId = last.Id;
                anchor.Hash = last.Hash ?? anchor.Hash;
                anchor.PrunedAtUtc = now;
                anchor.Mac = AuditChain.SealAnchor(keys.AuditKey, anchor);
                await db.SaveChangesAsync(cancellationToken);
            }

            var deleted = await db.AuditEntries.Where(e => e.Id <= last.Id).ExecuteDeleteAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return deleted;
        }
        finally
        {
            ChainLock.Release();
        }
    }

    /// <summary>
    /// Returns the anchor, creating it on the first write after the upgrade: entries already there were written before
    /// the chain and are left uncovered. When entries with hashes exist but the anchor does not, someone deleted it; it
    /// is not recreated (that would hide the deletion) and verification keeps reporting the chain as broken.
    /// </summary>
    private async Task<AuditChainAnchor?> EnsureAnchorAsync(CancellationToken cancellationToken)
    {
        if (await db.AuditChainAnchors.SingleOrDefaultAsync(cancellationToken) is { } existing)
        {
            return existing;
        }

        if (await db.AuditEntries.AnyAsync(e => e.Hash != null, cancellationToken))
        {
            return null;
        }

        var anchor = new AuditChainAnchor
        {
            LegacyThroughId = await db.AuditEntries.MaxAsync(e => (long?)e.Id, cancellationToken) ?? 0,
            StartedAtUtc = time.GetUtcNow().UtcDateTime,
            Hash = AuditChain.Genesis,
            Mac = [],
        };
        anchor.Mac = AuditChain.SealAnchor(keys.AuditKey, anchor);
        db.AuditChainAnchors.Add(anchor);
        await db.SaveChangesAsync(cancellationToken);
        return anchor;
    }

    /// <summary>Writes the entry to standard output as one JSON line.</summary>
    private void WriteLine(AuditEntry entry)
    {
        var line = JsonSerializer.Serialize(new
        {
            type = "maple-audit",
            id = entry.Id,
            atUtc = DateTime.SpecifyKind(entry.AtUtc, DateTimeKind.Utc),
            @event = entry.Event.ToString(),
            username = entry.Username,
            targetUsername = entry.TargetUsername,
            method = entry.Method,
            detail = entry.Detail,
            ipAddress = entry.IpAddress,
            hash = Convert.ToBase64String(entry.Hash!),
        }, StdoutJson);
        stdout.Writer.WriteLine(line);
        stdout.Writer.Flush();
    }

    /// <summary>One line without control characters, at most <paramref name="max"/> characters.</summary>
    private static string Clean(string? text, int max)
    {
        var line = new string((text ?? "").Trim().Select(c => char.IsControl(c) ? ' ' : c).ToArray());
        return line.Length <= max ? line : line[..max];
    }
}

/// <summary>Deletes old audit entries: at startup and then every hour.</summary>
internal sealed class AuditLogCleanupService(IServiceScopeFactory scopes, ILogger<AuditLogCleanupService> logger) : BackgroundService
{
    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<AuditLog>().PruneAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Audit log cleanup failed; it will be retried in an hour.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
