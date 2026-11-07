namespace MapleNotes.Server.Domain;

/// <summary>A passkey (WebAuthn public-key credential) that signs in to an account without the password.</summary>
/// <remarks>
/// The server keeps only the public key. The private key stays in the authenticator (a phone, a security key, or a
/// password manager that syncs passkeys), which asks for a fingerprint, face or PIN before it signs.
/// </remarks>
public sealed class Passkey
{
    /// <summary>The most passkeys one account can have.</summary>
    public const int MaxPerAccount = 20;

    /// <summary>The longest name, in characters.</summary>
    public const int MaxNameLength = 64;

    /// <summary>The longest credential ID WebAuthn allows, in bytes.</summary>
    public const int MaxCredentialIdBytes = 1023;

    /// <summary>Gets the row's identifier.</summary>
    public Guid Id { get; init; } = Guid.CreateVersion7();

    /// <summary>Gets the owning account.</summary>
    public Guid UserId { get; init; }

    /// <summary>Gets the credential ID the authenticator chose.</summary>
    public required byte[] CredentialId { get; init; }

    /// <summary>Gets the public key as a DER SubjectPublicKeyInfo.</summary>
    public required byte[] PublicKey { get; init; }

    /// <summary>Gets the COSE algorithm of the key (-7 for ES256, -257 for RS256).</summary>
    public int Algorithm { get; init; }

    /// <summary>Gets or sets the last signature counter the authenticator reported (0 for most synced passkeys).</summary>
    public long SignCount { get; set; }

    /// <summary>Gets or sets the name the owner gave it.</summary>
    public required string Name { get; set; }

    /// <summary>Gets or sets whether the authenticator said the passkey is backed up (synced to other devices).</summary>
    public bool BackedUp { get; set; }

    /// <summary>Gets or sets the transports the browser reported, comma-separated (for example <c>internal,hybrid</c>).</summary>
    public string? Transports { get; set; }

    /// <summary>
    /// Gets or sets the account's end-to-end data key wrapped with a key derived from the passkey's PRF output
    /// (docs/e2ee-spec.md §6a), or null when the passkey does not unlock the notes.
    /// </summary>
    public byte[]? E2eeWrappedKey { get; set; }

    /// <summary>Gets when it was added.</summary>
    public DateTime CreatedAtUtc { get; init; }

    /// <summary>Gets or sets when it last signed in, if ever.</summary>
    public DateTime? LastUsedAtUtc { get; set; }
}
