using System.Security.Cryptography;

namespace MapleNotes.Server.Domain;

/// <summary>An account on this Maple Notes instance.</summary>
public sealed class User
{
    /// <summary>Primary key (UUID version 7, so IDs sort by creation time).</summary>
    public Guid Id { get; init; } = Guid.CreateVersion7();

    /// <summary>Login name, with the casing the user chose.</summary>
    public required string Username { get; set; }

    /// <summary>Upper-invariant form of <see cref="Username"/>; unique, used for case-insensitive lookups.</summary>
    public required string NormalizedUsername { get; set; }

    /// <summary>Name shown in the interface.</summary>
    public required string DisplayName { get; set; }

    /// <summary>
    /// Salted hash (PBKDF2-HMAC-SHA512, ASP.NET Core Identity format) of the sign-in credential; see
    /// <see cref="CredentialFormat"/> for what was hashed. The server never stores or receives the password itself,
    /// except once from a <see cref="Domain.CredentialFormat.LegacyPassword"/> account while it is upgraded.
    /// </summary>
    public required string CredentialHash { get; set; }

    /// <summary>What <see cref="CredentialHash"/> is a hash of.</summary>
    public CredentialFormat CredentialFormat { get; set; } = CredentialFormat.AuthKey;

    /// <summary>
    /// The 16-byte Argon2id salt the browser uses to derive this account's keys from the password
    /// (docs/e2ee-spec.md §1). Not secret: prelogin hands it to anyone who asks.
    /// </summary>
    public required byte[] KdfSalt { get; set; }

    /// <summary>Argon2id memory in KiB for this account's key derivation.</summary>
    public int KdfMemoryKiB { get; set; }

    /// <summary>Argon2id passes for this account's key derivation.</summary>
    public int KdfIterations { get; set; }

    /// <summary>Argon2id lanes for this account's key derivation.</summary>
    public int KdfParallelism { get; set; }

    /// <summary>What the account may do.</summary>
    public UserRole Role { get; set; } = UserRole.User;

    /// <summary>
    /// The user's server-held data key (for <see cref="ContentScheme.Server"/> content), encrypted with the instance
    /// key-encryption key. Deleting the row destroys it, which makes any leftover encrypted content of this user
    /// unreadable. Null once an end-to-end account has no server-encrypted content left: the server then holds no
    /// key to any of the account's content.
    /// </summary>
    public byte[]? WrappedDataKey { get; set; }

    /// <summary>
    /// How new content is protected. Existing items are converted to match: by the server between
    /// <see cref="EncryptionMode.Off"/> and <see cref="EncryptionMode.AtRest"/>, by the browser to and from
    /// <see cref="EncryptionMode.EndToEnd"/>.
    /// </summary>
    public EncryptionMode EncryptionMode { get; set; }

    /// <summary>
    /// The end-to-end data key, wrapped by the browser with the key derived from the password
    /// (docs/e2ee-spec.md §2–§3). The server cannot unwrap it. Null when the account has no end-to-end key.
    /// </summary>
    public byte[]? E2eeWrappedKey { get; set; }

    /// <summary>The end-to-end data key wrapped with the recovery key (docs/e2ee-spec.md §6).</summary>
    public byte[]? E2eeRecoveryWrappedKey { get; set; }

    /// <summary>
    /// The account's mode as its owner chose it, sealed by the browser with the end-to-end key (docs/e2ee-spec.md §3a).
    /// Browsers holding the key decrypt content for a mode without end-to-end encryption only when this record says so,
    /// so the server cannot make them give up end-to-end encryption. Null when the account has no end-to-end key.
    /// </summary>
    public byte[]? E2eeModeRecord { get; set; }

    /// <summary>PBKDF2 hash of the authentication key derived from the recovery key; proves it for a password reset.</summary>
    public string? RecoveryKeyHash { get; set; }

    /// <summary>
    /// Random value embedded in sign-in cookies. Changing it (password change, "sign out everywhere") invalidates
    /// every existing session of the user.
    /// </summary>
    public string SecurityStamp { get; set; } = NewSecurityStamp();

    /// <summary>Consecutive failed sign-in attempts since the last success.</summary>
    public int AccessFailedCount { get; set; }

    /// <summary>When set and in the future, sign-in is refused until this time (UTC).</summary>
    public DateTime? LockoutEndUtc { get; set; }

    /// <summary>Writing and feature preferences, shared by all of the account's devices.</summary>
    public UserPreferences Preferences { get; set; } = new();

    /// <summary>Disabled accounts cannot sign in; set by an administrator.</summary>
    public bool IsDisabled { get; set; }

    /// <summary>When the account was created (UTC).</summary>
    public DateTime CreatedAtUtc { get; set; }

    /// <summary>When the account was last changed (UTC).</summary>
    public DateTime UpdatedAtUtc { get; set; }

    /// <summary>Creates a new random security stamp.</summary>
    /// <returns>32 hexadecimal characters.</returns>
    public static string NewSecurityStamp() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
}

/// <summary>What an account's <see cref="User.CredentialHash"/> is a hash of.</summary>
public enum CredentialFormat
{
    /// <summary>
    /// The password itself (accounts created by version 1.0). Replaced by <see cref="AuthKey"/> the next time the
    /// owner signs in or confirms the password.
    /// </summary>
    LegacyPassword = 1,

    /// <summary>The authentication key the browser derives from the password; the password never reaches the server.</summary>
    AuthKey = 2,
}

/// <summary>Account roles.</summary>
public enum UserRole
{
    /// <summary>A regular account: manages only its own notes.</summary>
    User = 0,

    /// <summary>Can also manage instance settings and other accounts. The first account is always an administrator.</summary>
    Admin = 1,
}
