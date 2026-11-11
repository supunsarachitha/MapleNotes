namespace MapleNotes.Server.Domain;

/// <summary>What an audit entry records.</summary>
public enum AuditEvent
{
    /// <summary>Someone signed in.</summary>
    SignIn,

    /// <summary>A sign-in was refused.</summary>
    SignInFailed,

    /// <summary>An administrator changed the server's settings.</summary>
    SettingsChanged,

    /// <summary>An administrator changed an account.</summary>
    AccountChanged,

    /// <summary>An administrator deleted an account.</summary>
    AccountDeleted,

    /// <summary>Someone changed their own password, or reset it with the recovery key.</summary>
    PasswordChanged,

    /// <summary>Someone turned on two-factor sign-in.</summary>
    TwoFactorEnabled,

    /// <summary>Someone turned off two-factor sign-in.</summary>
    TwoFactorDisabled,

    /// <summary>Someone replaced their two-factor recovery codes.</summary>
    RecoveryCodesReplaced,

    /// <summary>Someone added a passkey.</summary>
    PasskeyAdded,

    /// <summary>Someone removed a passkey.</summary>
    PasskeyRemoved,

    /// <summary>Someone replaced the recovery key of their end-to-end notes.</summary>
    RecoveryKeyReplaced,

    /// <summary>Someone changed how their notes are encrypted.</summary>
    EncryptionChanged,

    /// <summary>Someone signed out of every browser and device.</summary>
    SignedOutEverywhere,
}

/// <summary>
/// One line of the audit log: a sign-in, a refused sign-in, a change to someone's own sign-in or encryption, or an
/// administrator's action. Usernames are copied in, so entries stay readable after an account is renamed or deleted;
/// there is no link to the account. Entries are deleted after <see cref="RetentionDays"/>.
/// </summary>
/// <remarks>
/// Entries form a hash chain (see <c>AuditChain</c>): <see cref="Hash"/> is an HMAC, under a key derived from the
/// master key, of the previous entry's hash and this entry's content. Editing or deleting an entry in the database
/// breaks the chain from that point on, which <c>GET /api/v1/admin/audit/verify</c> reports.
/// </remarks>
public sealed class AuditEntry
{
    /// <summary>How long entries are kept.</summary>
    public const int RetentionDays = 180;

    /// <summary>Longest username stored (as for accounts; longer attempts are cut).</summary>
    public const int MaxUsernameLength = 64;

    /// <summary>Longest description stored.</summary>
    public const int MaxDetailLength = 500;

    /// <summary>Increasing number, newest highest; the cursor for paging.</summary>
    public long Id { get; init; }

    /// <summary>When it happened.</summary>
    public DateTime AtUtc { get; init; }

    /// <summary>What happened.</summary>
    public AuditEvent Event { get; init; }

    /// <summary>
    /// Who signed in, tried to, or acted: the username given at sign-in (even for no such account), or the
    /// administrator's; empty when a passkey nobody owns was used.
    /// </summary>
    public required string Username { get; init; }

    /// <summary>The account an administrator changed or deleted.</summary>
    public string? TargetUsername { get; init; }

    /// <summary>How a sign-in was made: <c>Password</c> or <c>Passkey</c>.</summary>
    public string? Method { get; init; }

    /// <summary>What was refused or changed, in a sentence.</summary>
    public required string Detail { get; init; }

    /// <summary>The address the request came from (after trusted proxies), when known.</summary>
    public string? IpAddress { get; init; }

    /// <summary>
    /// HMAC-SHA256 of the previous entry's hash and this entry's content; null only for an entry written before
    /// version 1.22 that has not been sealed yet (that happens at the next write or prune).
    /// </summary>
    public byte[]? Hash { get; set; }
}

/// <summary>
/// Where the audit chain starts: the entries written before the chain existed, and the last entry deleted by pruning.
/// The oldest kept entry must link to <see cref="Hash"/>, so pruning does not look like tampering, while deleting the
/// oldest kept entries still does. <see cref="Mac"/> covers the other fields, so the anchor cannot be moved to hide a
/// deletion either. There is one row, created by the first audit write.
/// </summary>
public sealed class AuditChainAnchor
{
    /// <summary>The only row's key.</summary>
    public const int SingletonId = 1;

    /// <summary>Always <see cref="SingletonId"/>.</summary>
    public int Id { get; init; } = SingletonId;

    /// <summary>The newest entry written before the chain started (before version 1.22); those entries are not covered.</summary>
    public long LegacyThroughId { get; init; }

    /// <summary>When the chain started.</summary>
    public DateTime StartedAtUtc { get; init; }

    /// <summary>The number of the newest entry deleted by pruning, or 0.</summary>
    public long PrunedThroughId { get; set; }

    /// <summary>The hash the oldest kept entry links to: the last pruned entry's hash, or 32 zero bytes.</summary>
    public required byte[] Hash { get; set; }

    /// <summary>When the chain was last pruned.</summary>
    public DateTime? PrunedAtUtc { get; set; }

    /// <summary>HMAC-SHA256 of the fields above.</summary>
    public required byte[] Mac { get; set; }
}
