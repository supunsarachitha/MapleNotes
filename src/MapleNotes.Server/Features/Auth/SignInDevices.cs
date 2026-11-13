using System.Net;
using System.Net.Sockets;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Push;
using MapleNotes.Server.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Auth;

/// <summary>A sign-in from a new device the owner has not dismissed yet.</summary>
/// <param name="Id">The notice.</param>
/// <param name="Device">A short description of the browser, such as "Firefox on Windows".</param>
/// <param name="AtUtc">When it signed in.</param>
public sealed record SignInNoticeResponse(Guid Id, string Device, DateTime AtUtc);

/// <summary>
/// Notices sign-ins from a browser and network the account has not used in the last
/// <see cref="KnownDevice.RememberDays"/> days, so the owner can spot a sign-in they did not make: a push notification
/// to their subscribed devices, a banner in the app until they dismiss it, and a mark in the device list. It compares
/// only the device description and the network, which the session list already shows; nothing about notes.
/// </summary>
/// <param name="db">Database.</param>
/// <param name="push">Push notifications.</param>
/// <param name="time">Clock.</param>
/// <param name="logger">Logger.</param>
public sealed class SignInDevices(MapleDbContext db, PushService push, TimeProvider time, ILogger<SignInDevices> logger)
{
    /// <summary>The push message's tag; the service worker opens the device list for it.</summary>
    public const string PushTag = "new-sign-in";

    /// <summary>
    /// Shortens an address to its network (an IPv4 /24 or IPv6 /48), so that an address that changes within one
    /// home or mobile network does not count as a new device, and only the network is remembered.
    /// </summary>
    /// <param name="address">The client's address (after trusted proxies), or null.</param>
    /// <returns>The network, or an empty string when the address is unknown.</returns>
    public static string NetworkOf(IPAddress? address)
    {
        if (address is null)
        {
            return "";
        }

        if (address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }

        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            return $"{bytes[0]}.{bytes[1]}.{bytes[2]}.0/24";
        }

        var prefix = new byte[16];
        Array.Copy(bytes, prefix, 6);
        return $"{new IPAddress(prefix)}/48";
    }

    /// <summary>The push message about a sign-in from a new device. It carries no note content.</summary>
    /// <param name="device">The device description.</param>
    /// <returns>The message.</returns>
    public static PushMessage Message(string device) =>
        new("New sign-in", $"{device} signed in to your account. Not you? Open Settings and sign out everywhere.", Tag: PushTag);

    /// <summary>
    /// Remembers the device a new session signs in from, and marks the session as a new device when the account
    /// already had others and none of them matches. The caller saves the changes.
    /// </summary>
    /// <param name="user">The account.</param>
    /// <param name="session">The new session (not saved yet).</param>
    /// <param name="address">The client's address (after trusted proxies), or null.</param>
    /// <param name="mayNotify">
    /// False for a session made for a cookie from before version 1.22: that browser was signed in already.
    /// </param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>A task that completes when the device is recorded.</returns>
    public async Task RecordAsync(User user, Session session, IPAddress? address, bool mayNotify, CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow().UtcDateTime;
        var network = NetworkOf(address);
        await db.KnownDevices
            .Where(d => d.UserId == user.Id && d.LastSeenAtUtc <= now.AddDays(-KnownDevice.RememberDays))
            .ExecuteDeleteAsync(cancellationToken);

        var known = await db.KnownDevices
            .FirstOrDefaultAsync(d => d.UserId == user.Id && d.Device == session.Device && d.Network == network, cancellationToken);
        if (known is not null)
        {
            known.LastSeenAtUtc = now;
            return;
        }

        // Sessions from before version 1.22 have no remembered device yet: a live one from the same device and
        // network counts as known, and an account with no history at all (its first sign-in) is not warned.
        var others = await db.Sessions.AsNoTracking().Where(s => s.UserId == user.Id && s.Id != session.Id)
            .Select(s => new { s.Device, s.IpAddress }).ToListAsync(cancellationToken);
        var seenBySession = others.Any(s => s.Device == session.Device
            && NetworkOf(IPAddress.TryParse(s.IpAddress, out var other) ? other : null) == network);
        var hasHistory = others.Count > 0 || await db.KnownDevices.AnyAsync(d => d.UserId == user.Id, cancellationToken);
        session.NewDevice = mayNotify && hasHistory && !seenBySession;
        db.KnownDevices.Add(new KnownDevice
        {
            UserId = user.Id,
            Device = session.Device,
            Network = network,
            FirstSeenAtUtc = now,
            LastSeenAtUtc = now,
            NoticePending = session.NewDevice,
            NoticeSessionId = session.NewDevice ? session.Id : null,
        });
    }

    /// <summary>
    /// Sends the push notification about a session from a new device to the account's subscribed devices. A push
    /// service that cannot be reached never fails the sign-in.
    /// </summary>
    /// <param name="session">The saved session.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>A task that completes when the notifications are sent.</returns>
    public async Task NotifyAsync(Session session, CancellationToken cancellationToken)
    {
        if (!session.NewDevice)
        {
            return;
        }

        try
        {
            await push.SendToAccountAsync(session.UserId, Message(session.Device), cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "The new-device notification could not be sent.");
        }
    }

    /// <summary>Lists the account's pending notices, newest first, leaving out the one about the asking session.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="currentSessionId">The session asking.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The notices.</returns>
    public async Task<IReadOnlyList<SignInNoticeResponse>> PendingAsync(Guid userId, Guid? currentSessionId, CancellationToken cancellationToken) =>
        await db.KnownDevices.AsNoTracking()
            .Where(d => d.UserId == userId && d.NoticePending && d.NoticeSessionId != currentSessionId)
            .OrderByDescending(d => d.FirstSeenAtUtc)
            .Select(d => new SignInNoticeResponse(d.Id, d.Device, d.FirstSeenAtUtc))
            .ToListAsync(cancellationToken);

    /// <summary>Dismisses one of the account's notices.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="id">The notice.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>True when a pending notice of the account was dismissed.</returns>
    public async Task<bool> DismissAsync(Guid userId, Guid id, CancellationToken cancellationToken) =>
        await db.KnownDevices.Where(d => d.UserId == userId && d.Id == id && d.NoticePending)
            .ExecuteUpdateAsync(d => d.SetProperty(x => x.NoticePending, false), cancellationToken) > 0;

    /// <summary>Dismisses every notice of the account (after signing out everywhere, nothing is left to act on).</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>A task that completes when they are dismissed.</returns>
    public Task DismissAllAsync(Guid userId, CancellationToken cancellationToken) =>
        db.KnownDevices.Where(d => d.UserId == userId && d.NoticePending)
            .ExecuteUpdateAsync(d => d.SetProperty(x => x.NoticePending, false), cancellationToken);
}
