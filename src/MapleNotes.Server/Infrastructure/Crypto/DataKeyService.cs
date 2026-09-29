using System.Security.Cryptography;
using System.Text;

namespace MapleNotes.Server.Infrastructure.Crypto;

/// <summary>
/// Creates and unwraps per-user data keys.
/// </summary>
/// <remarks>
/// Each user has a random 256-bit data key that encrypts their note bodies and attachment files. It is stored in the
/// user's row wrapped (encrypted) with the instance key-encryption key, and the wrapping is bound to the user's ID, so
/// a wrapped key copied onto another row will not unwrap. Deleting the user row destroys the only copy of the wrapped
/// key, which leaves any stray ciphertext of that user permanently unreadable ("crypto-shredding").
/// The wrapped plaintext is the 32 key bytes followed by one byte holding the data key's version.
/// </remarks>
/// <param name="keys">The instance key hierarchy.</param>
public sealed class DataKeyService(KeyMaterial keys)
{
    /// <summary>Generation of the key-encryption key used for new wrappings.</summary>
    public const byte CurrentWrappingVersion = 1;

    /// <summary>Generation assigned to newly created data keys.</summary>
    public const byte CurrentDataKeyVersion = 1;

    /// <summary>
    /// Generates a new data key for a user and returns it in wrapped form, ready to store.
    /// </summary>
    /// <param name="userId">The owner's ID; the wrapped key only unwraps for this ID.</param>
    /// <returns>The wrapped key.</returns>
    public byte[] CreateWrappedKey(Guid userId)
    {
        var dataKey = RandomNumberGenerator.GetBytes(AeadEnvelope.KeySize + 1);
        dataKey[^1] = CurrentDataKeyVersion;
        try
        {
            return AeadEnvelope.Seal(keys.KeyEncryptionKey, CurrentWrappingVersion, dataKey, AssociatedData(userId));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(dataKey);
        }
    }

    /// <summary>
    /// Unwraps a user's data key.
    /// </summary>
    /// <param name="userId">The owner's ID.</param>
    /// <param name="wrappedKey">The value produced by <see cref="CreateWrappedKey"/>.</param>
    /// <returns>The key; dispose it when done.</returns>
    /// <exception cref="CryptographicException">The wrapped key was modified, belongs to another user, or the
    /// master key is different from the one that wrapped it.</exception>
    public UserDataKey Unwrap(Guid userId, byte[] wrappedKey)
    {
        var unwrapped = AeadEnvelope.Open(keys.KeyEncryptionKey, wrappedKey, AssociatedData(userId));
        try
        {
            if (unwrapped.Length != AeadEnvelope.KeySize + 1)
            {
                throw new CryptographicException("The wrapped data key has an unexpected length.");
            }

            return new UserDataKey(unwrapped[..AeadEnvelope.KeySize], unwrapped[^1]);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(unwrapped);
        }
    }

    private static byte[] AssociatedData(Guid userId) =>
        Encoding.UTF8.GetBytes($"maple-notes/v1/user-data-key/{userId:N}");
}
