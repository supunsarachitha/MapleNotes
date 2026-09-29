namespace MapleNotes.Server.Domain;

/// <summary>How an account protects its notes and attachments. The database itself is always encrypted.</summary>
public enum EncryptionMode
{
    /// <summary>No per-account encryption.</summary>
    Off = 0,

    /// <summary>Encrypted by the server with the account's data key, which the server holds (encryption at rest).</summary>
    AtRest = 1,

    /// <summary>
    /// Encrypted in the browser with a key the server never sees (end-to-end encryption, docs/e2ee-spec.md). The
    /// server accepts only ciphertext for new content.
    /// </summary>
    EndToEnd = 2,
}

/// <summary>
/// How one stored note or attachment is protected. Every item records its own scheme, so all content stays readable
/// while an account changes mode and its existing items are converted.
/// </summary>
public enum ContentScheme
{
    /// <summary>Stored as is (the database file is still encrypted as a whole).</summary>
    None = 0,

    /// <summary>Encrypted by the server with the owner's server-held data key (format version 1).</summary>
    Server = 1,

    /// <summary>Encrypted by the owner's browser (format version 2); the server cannot decrypt it.</summary>
    EndToEnd = 2,
}
