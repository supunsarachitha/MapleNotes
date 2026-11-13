namespace MapleNotes.Server.Domain;

/// <summary>
/// One signed-in browser or device. The sign-in cookie carries the session's ID and is accepted only while this row
/// exists, so signing out (here or from another device) ends the session on the server, not only in one browser.
/// </summary>
public sealed class Session
{
    /// <summary>Longest device description kept.</summary>
    public const int MaxDeviceLength = 100;

    /// <summary>Longest IP address text kept (an IPv6 address with a zone).</summary>
    public const int MaxIpAddressLength = 64;

    /// <summary>Its ID, carried in the sign-in cookie.</summary>
    public Guid Id { get; init; } = Guid.CreateVersion7();

    /// <summary>The account.</summary>
    public Guid UserId { get; init; }

    /// <summary>When the session started (the sign-in).</summary>
    public DateTime CreatedAtUtc { get; init; }

    /// <summary>When the session was last used, updated at most every few minutes.</summary>
    public DateTime LastSeenAtUtc { get; set; }

    /// <summary>
    /// When the session ends at the latest, however often it is used: the absolute lifetime
    /// (<c>MAPLE_SESSION_MAX_DAYS</c>) counted from the sign-in.
    /// </summary>
    public DateTime ExpiresAtUtc { get; init; }

    /// <summary>
    /// The account's security stamp when the session was issued or last re-issued. A session whose stamp no longer
    /// matches was ended by a password change or "sign out everywhere" and is removed.
    /// </summary>
    public required string SecurityStamp { get; set; }

    /// <summary>A short description of the browser, such as "Firefox on Windows".</summary>
    public required string Device { get; set; }

    /// <summary>
    /// When the person last proved they are present in this session (the sign-in, or a password, passkey or
    /// authenticator code given later), or null when they never did, as for sessions from before version 1.22.
    /// Exports, administration and second-factor changes need one from the last few minutes.
    /// </summary>
    public DateTime? ConfirmedAtUtc { get; set; }

    /// <summary>The client's address last seen (after trusted proxies), or null when unknown.</summary>
    public string? IpAddress { get; set; }

    /// <summary>
    /// Whether the session started from a browser and network the account had not signed in from in the last
    /// <see cref="KnownDevice.RememberDays"/> days (shown as "New device" in the list).
    /// </summary>
    public bool NewDevice { get; set; }
}
