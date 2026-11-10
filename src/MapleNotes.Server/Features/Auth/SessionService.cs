using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Auth;

/// <summary>
/// Keeps the server-side record of each signed-in browser. The cookie only names a session; whether it is still
/// valid is decided here on every request, so a session can be ended from the server (sign-out, another device,
/// password change) and ends for good after its absolute lifetime.
/// </summary>
/// <param name="db">Database.</param>
/// <param name="settings">Instance settings (the idle session length).</param>
/// <param name="options">Server options (the absolute session lifetime).</param>
/// <param name="time">Clock.</param>
public sealed class SessionService(MapleDbContext db, InstanceSettingsService settings, MapleOptions options, TimeProvider time)
{
    /// <summary>
    /// How stale the "last seen" time may get before a request writes it again: one write per few minutes instead of
    /// one per request.
    /// </summary>
    public static readonly TimeSpan LastSeenResolution = TimeSpan.FromMinutes(5);

    /// <summary>Starts a session for <paramref name="user"/>, and clears the account's sessions that have ended.</summary>
    /// <param name="http">The sign-in request (for the device description and address).</param>
    /// <param name="user">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The new session.</returns>
    public async Task<Session> StartAsync(HttpContext http, User user, CancellationToken cancellationToken)
    {
        await PruneAsync(user, cancellationToken);
        var now = time.GetUtcNow().UtcDateTime;
        var session = new Session
        {
            UserId = user.Id,
            CreatedAtUtc = now,
            LastSeenAtUtc = now,
            ExpiresAtUtc = now.AddDays(options.SessionMaxDays),
            SecurityStamp = user.SecurityStamp,
            Device = DeviceDescription.FromUserAgent(http.Request.Headers.UserAgent.ToString()),
            IpAddress = Truncate(http.Connection.RemoteIpAddress?.ToString(), Session.MaxIpAddressLength),
        };
        db.Sessions.Add(session);
        await db.SaveChangesAsync(cancellationToken);
        return session;
    }

    /// <summary>
    /// Records the account's new security stamp on the current session when its cookie is issued again (password
    /// change, two-factor sign-in turned on), so it stays valid while every other session ends.
    /// </summary>
    /// <param name="sessionId">The current session.</param>
    /// <param name="user">The account, with its new stamp.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>True when the session still exists.</returns>
    public async Task<bool> ReissueAsync(Guid sessionId, User user, CancellationToken cancellationToken) =>
        await db.Sessions
            .Where(s => s.Id == sessionId && s.UserId == user.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.SecurityStamp, user.SecurityStamp), cancellationToken) == 1;

    /// <summary>
    /// Checks the session named by a cookie: it must exist, belong to the account, carry the account's current
    /// security stamp, and be inside both its absolute lifetime and the idle limit. Notes when it was last used.
    /// </summary>
    /// <param name="sessionId">The session ID from the cookie.</param>
    /// <param name="user">The account the cookie names.</param>
    /// <param name="http">The current request.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>True when the session may be used.</returns>
    public async Task<bool> ValidateAsync(Guid sessionId, User user, HttpContext http, CancellationToken cancellationToken)
    {
        var session = await db.Sessions.AsNoTracking()
            .SingleOrDefaultAsync(s => s.Id == sessionId && s.UserId == user.Id, cancellationToken);
        var now = time.GetUtcNow().UtcDateTime;
        if (session is null || !await IsLiveAsync(session, user, now, cancellationToken))
        {
            if (session is not null)
            {
                await db.Sessions.Where(s => s.Id == sessionId).ExecuteDeleteAsync(cancellationToken);
            }

            return false;
        }

        if (now - session.LastSeenAtUtc >= LastSeenResolution)
        {
            var address = Truncate(http.Connection.RemoteIpAddress?.ToString(), Session.MaxIpAddressLength);
            await db.Sessions.Where(s => s.Id == sessionId).ExecuteUpdateAsync(
                s => s.SetProperty(x => x.LastSeenAtUtc, now).SetProperty(x => x.IpAddress, address),
                cancellationToken);
        }

        return true;
    }

    /// <summary>Lists the account's live sessions, newest use first, after clearing the ones that have ended.</summary>
    /// <param name="user">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The sessions.</returns>
    public async Task<IReadOnlyList<Session>> ListAsync(User user, CancellationToken cancellationToken)
    {
        await PruneAsync(user, cancellationToken);
        return await db.Sessions.AsNoTracking()
            .Where(s => s.UserId == user.Id)
            .OrderByDescending(s => s.LastSeenAtUtc).ThenByDescending(s => s.CreatedAtUtc)
            .ToListAsync(cancellationToken);
    }

    /// <summary>Ends one of the account's sessions.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="sessionId">The session.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>True when a session of the account was ended.</returns>
    public async Task<bool> EndAsync(Guid userId, Guid sessionId, CancellationToken cancellationToken) =>
        await db.Sessions.Where(s => s.Id == sessionId && s.UserId == userId).ExecuteDeleteAsync(cancellationToken) > 0;

    /// <summary>Ends every session of the account.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>A task that completes when they are deleted.</returns>
    public Task EndAllAsync(Guid userId, CancellationToken cancellationToken) =>
        db.Sessions.Where(s => s.UserId == userId).ExecuteDeleteAsync(cancellationToken);

    private async Task<bool> IsLiveAsync(Session session, User user, DateTime now, CancellationToken cancellationToken) =>
        session.ExpiresAtUtc > now
        && session.SecurityStamp == user.SecurityStamp
        && session.LastSeenAtUtc > now.AddDays(-await settings.GetSessionDaysAsync(cancellationToken));

    // Deletes the account's sessions that can no longer be used, so they do not pile up or show in the device list.
    private async Task PruneAsync(User user, CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var idleSince = now.AddDays(-await settings.GetSessionDaysAsync(cancellationToken));
        await db.Sessions
            .Where(s => s.UserId == user.Id
                && (s.ExpiresAtUtc <= now || s.SecurityStamp != user.SecurityStamp || s.LastSeenAtUtc <= idleSince))
            .ExecuteDeleteAsync(cancellationToken);
    }

    private static string? Truncate(string? value, int length) =>
        value is null || value.Length <= length ? value : value[..length];
}
