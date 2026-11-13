namespace MapleNotes.Server.Domain;

/// <summary>
/// A browser and network an account signed in from, remembered for <see cref="RememberDays"/> days so that a sign-in
/// from somewhere new can be pointed out to the owner. It holds only what the session list and audit log already
/// hold: the short device description and a shortened address (the network, not the address itself).
/// </summary>
public sealed class KnownDevice
{
    /// <summary>How long a device stays known after its last sign-in.</summary>
    public const int RememberDays = 90;

    /// <summary>Longest network text kept (an IPv6 /48 prefix).</summary>
    public const int MaxNetworkLength = 64;

    /// <summary>Its ID; also the ID of its sign-in notice.</summary>
    public Guid Id { get; init; } = Guid.CreateVersion7();

    /// <summary>The account.</summary>
    public Guid UserId { get; init; }

    /// <summary>A short description of the browser, such as "Firefox on Windows".</summary>
    public required string Device { get; init; }

    /// <summary>The network signed in from (an IPv4 /24 or IPv6 /48), or empty when the address is unknown.</summary>
    public required string Network { get; init; }

    /// <summary>The first sign-in from it.</summary>
    public DateTime FirstSeenAtUtc { get; init; }

    /// <summary>The latest sign-in from it.</summary>
    public DateTime LastSeenAtUtc { get; set; }

    /// <summary>
    /// Whether the owner still has to see the notice about the first sign-in from it. Set only when the account
    /// already had other devices; cleared when they dismiss it or sign out everywhere.
    /// </summary>
    public bool NoticePending { get; set; }

    /// <summary>The session that signed in from it first, so that session itself is not warned about itself.</summary>
    public Guid? NoticeSessionId { get; init; }
}
