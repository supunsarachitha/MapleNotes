using System.Text;

namespace MapleNotes.Server.Infrastructure.Crypto;

/// <summary>
/// Encrypts note bodies with the owner's data key (AES-256-GCM via <see cref="AeadEnvelope"/>).
/// </summary>
/// <remarks>
/// Each ciphertext is bound to its user and note IDs, so copying an encrypted body onto another note, or into another
/// user's account, makes it fail to decrypt instead of silently showing the wrong content.
/// </remarks>
internal static class NoteCipher
{
    /// <summary>Encrypts a note body.</summary>
    /// <param name="key">The owner's data key.</param>
    /// <param name="userId">The owner's ID.</param>
    /// <param name="noteId">The note's ID.</param>
    /// <param name="content">The Markdown text.</param>
    /// <returns>The envelope bytes to store.</returns>
    public static byte[] Encrypt(UserDataKey key, Guid userId, Guid noteId, string content) =>
        AeadEnvelope.Seal(key.Span, key.Version, Encoding.UTF8.GetBytes(content), AssociatedData(userId, noteId));

    /// <summary>Decrypts a note body.</summary>
    /// <param name="key">The owner's data key.</param>
    /// <param name="userId">The owner's ID.</param>
    /// <param name="noteId">The note's ID.</param>
    /// <param name="envelope">Bytes produced by <see cref="Encrypt"/>.</param>
    /// <returns>The Markdown text.</returns>
    /// <exception cref="System.Security.Cryptography.CryptographicException">The ciphertext was modified, moved or
    /// encrypted with a different key.</exception>
    public static string Decrypt(UserDataKey key, Guid userId, Guid noteId, byte[] envelope) =>
        Encoding.UTF8.GetString(AeadEnvelope.Open(key.Span, envelope, AssociatedData(userId, noteId)));

    private static byte[] AssociatedData(Guid userId, Guid noteId) =>
        Encoding.UTF8.GetBytes($"maple-notes/v1/note/{userId:N}/{noteId:N}");
}
