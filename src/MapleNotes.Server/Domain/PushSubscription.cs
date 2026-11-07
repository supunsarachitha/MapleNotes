namespace MapleNotes.Server.Domain;

/// <summary>
/// One device's (browser's) Web Push subscription: where to send notifications for the account, and the keys to
/// encrypt them with (RFC 8291). Removed when the push service says it is gone, or when the device turns them off.
/// </summary>
public sealed class PushSubscription
{
    /// <summary>Most subscriptions an account can have.</summary>
    public const int MaxPerAccount = 20;

    /// <summary>Longest endpoint URL accepted.</summary>
    public const int MaxEndpointLength = 1000;

    /// <summary>Longest device name kept.</summary>
    public const int MaxNameLength = 64;

    /// <summary>Its ID.</summary>
    public Guid Id { get; init; } = Guid.CreateVersion7();

    /// <summary>The account.</summary>
    public Guid UserId { get; init; }

    /// <summary>The push service URL to POST messages to (https, public addresses only).</summary>
    public required string Endpoint { get; init; }

    /// <summary>The browser's P-256 public key (65 bytes, uncompressed).</summary>
    public required byte[] P256dh { get; set; }

    /// <summary>The browser's 16-byte authentication secret.</summary>
    public required byte[] Auth { get; set; }

    /// <summary>A name for the device, such as "Chrome on Android".</summary>
    public required string Name { get; set; }

    /// <summary>When it was added.</summary>
    public DateTime CreatedAtUtc { get; init; }

    /// <summary>When a message last reached the push service.</summary>
    public DateTime? LastSentAtUtc { get; set; }
}
