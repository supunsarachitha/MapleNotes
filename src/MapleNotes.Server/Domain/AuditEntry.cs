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
}

/// <summary>
/// One line of the audit log: a sign-in, a refused sign-in, or an administrator's action. Usernames are copied in, so
/// entries stay readable after an account is renamed or deleted; there is no link to the account. Entries are deleted
/// after <see cref="RetentionDays"/>.
/// </summary>
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
}
