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

    /// <summary>Salted password hash (PBKDF2-HMAC-SHA512, ASP.NET Core Identity format).</summary>
    public required string PasswordHash { get; set; }

    /// <summary>What the account may do.</summary>
    public UserRole Role { get; set; } = UserRole.User;

    /// <summary>
    /// The user's data key, encrypted with the instance key-encryption key. Deleting the row destroys it, which
    /// makes any leftover encrypted content of this user unreadable.
    /// </summary>
    public required byte[] WrappedDataKey { get; set; }

    /// <summary>Whether new and existing note bodies and attachments are encrypted with the user's data key.</summary>
    public bool EncryptionEnabled { get; set; }

    /// <summary>
    /// Random value embedded in sign-in cookies. Changing it (password change, "sign out everywhere") invalidates
    /// every existing session of the user.
    /// </summary>
    public string SecurityStamp { get; set; } = NewSecurityStamp();

    /// <summary>Consecutive failed sign-in attempts since the last success.</summary>
    public int AccessFailedCount { get; set; }

    /// <summary>When set and in the future, sign-in is refused until this time (UTC).</summary>
    public DateTime? LockoutEndUtc { get; set; }

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

/// <summary>Account roles.</summary>
public enum UserRole
{
    /// <summary>A regular account: manages only its own notes.</summary>
    User = 0,

    /// <summary>Can also manage instance settings and other accounts. The first account is always an administrator.</summary>
    Admin = 1,
}
