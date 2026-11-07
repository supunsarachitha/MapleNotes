using MapleNotes.Server.Domain;
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

/// <summary>Writes, lists and prunes the audit log (sign-ins and administrators' actions).</summary>
public sealed class AuditLog(MapleDbContext db, TimeProvider time, IHttpContextAccessor http)
{
    /// <summary>Most entries in one page.</summary>
    public const int MaxPageSize = 100;

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
        db.AuditEntries.Add(new AuditEntry
        {
            AtUtc = time.GetUtcNow().UtcDateTime,
            Event = @event,
            Username = Clean(username, AuditEntry.MaxUsernameLength),
            TargetUsername = target is null ? null : Clean(target, AuditEntry.MaxUsernameLength),
            Method = method,
            Detail = Clean(detail, AuditEntry.MaxDetailLength),
            IpAddress = http.HttpContext?.Connection.RemoteIpAddress?.ToString(),
        });
        await db.SaveChangesAsync(cancellationToken);
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
            AuditFilter.Admin => query.Where(e => e.Event != AuditEvent.SignIn && e.Event != AuditEvent.SignInFailed),
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

    /// <summary>Deletes entries older than <see cref="AuditEntry.RetentionDays"/>.</summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>How many were deleted.</returns>
    public Task<int> PruneAsync(CancellationToken cancellationToken)
    {
        var cutoff = time.GetUtcNow().UtcDateTime.AddDays(-AuditEntry.RetentionDays);
        return db.AuditEntries.Where(e => e.AtUtc < cutoff).ExecuteDeleteAsync(cancellationToken);
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
