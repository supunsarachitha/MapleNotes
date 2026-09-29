using System.Security.Cryptography;
using MapleNotes.Server.Domain;
using Microsoft.AspNetCore.Identity;

namespace MapleNotes.Server.Features.Auth;

/// <summary>
/// Stores and checks sign-in credentials.
/// </summary>
/// <remarks>
/// The credential is the authentication key that the browser derives from the password (docs/e2ee-spec.md §1). The
/// server keeps only a PBKDF2 hash of it (see <see cref="PasswordHashing"/>), computed over its base64 text, so a
/// stolen database still has to be attacked through Argon2id and PBKDF2. Accounts created by version 1.0 hold a
/// hash of the password itself (<see cref="CredentialFormat.LegacyPassword"/>); the first successful check that
/// comes with the password replaces it with a hash of the authentication key sent alongside.
/// </remarks>
/// <param name="hasher">PBKDF2 hasher.</param>
public sealed class CredentialVerifier(IPasswordHasher<User> hasher)
{
    // A real hash of a random value. Checks for unknown usernames run against it so that a failure takes the same
    // time whether or not the account exists, which prevents discovering usernames by timing.
    private readonly Lazy<string> _dummyHash = new(() =>
        hasher.HashPassword(null!, Convert.ToBase64String(RandomNumberGenerator.GetBytes(KeyDerivation.AuthKeyBytes))));

    /// <summary>Makes <paramref name="authKey"/> the account's credential.</summary>
    /// <param name="user">The account; the caller saves it.</param>
    /// <param name="authKey">The new authentication key.</param>
    public void SetAuthKey(User user, byte[] authKey)
    {
        user.CredentialHash = hasher.HashPassword(user, Convert.ToBase64String(authKey));
        user.CredentialFormat = CredentialFormat.AuthKey;
    }

    /// <summary>
    /// Checks a credential. For a legacy account this checks <paramref name="password"/> instead and, when it is
    /// right, upgrades the account to <paramref name="authKey"/>.
    /// </summary>
    /// <param name="user">The account; changed in memory on upgrade or rehash, so the caller must save it.</param>
    /// <param name="authKey">The authentication key the caller derived.</param>
    /// <param name="password">The password; used only for a legacy account.</param>
    /// <returns>True when the credential is correct.</returns>
    public bool Verify(User user, byte[]? authKey, string? password)
    {
        if (!KeyDerivation.IsAuthKey(authKey))
        {
            SimulateCheck();
            return false;
        }

        if (user.CredentialFormat == CredentialFormat.LegacyPassword)
        {
            if (string.IsNullOrEmpty(password))
            {
                SimulateCheck();
                return false;
            }

            if (hasher.VerifyHashedPassword(user, user.CredentialHash, password) == PasswordVerificationResult.Failed)
            {
                return false;
            }

            SetAuthKey(user, authKey);
            return true;
        }

        var result = hasher.VerifyHashedPassword(user, user.CredentialHash, Convert.ToBase64String(authKey));
        if (result == PasswordVerificationResult.SuccessRehashNeeded)
        {
            // Stored with older, weaker parameters: upgrade now that the key is known.
            SetAuthKey(user, authKey);
        }

        return result != PasswordVerificationResult.Failed;
    }

    /// <summary>Hashes the authentication key derived from an end-to-end recovery key (docs/e2ee-spec.md §6).</summary>
    /// <param name="user">The account.</param>
    /// <param name="recoveryAuthKey">The recovery authentication key.</param>
    /// <returns>The hash to store in <see cref="User.RecoveryKeyHash"/>.</returns>
    public string HashRecoveryKey(User user, byte[] recoveryAuthKey) =>
        hasher.HashPassword(user, Convert.ToBase64String(recoveryAuthKey));

    /// <summary>Checks the authentication key derived from the account's recovery key.</summary>
    /// <param name="user">The account.</param>
    /// <param name="recoveryAuthKey">The key to check.</param>
    /// <returns>False when it is wrong or the account has no recovery key (taking the same time either way).</returns>
    public bool VerifyRecoveryKey(User user, byte[]? recoveryAuthKey)
    {
        if (user.RecoveryKeyHash is null || !KeyDerivation.IsAuthKey(recoveryAuthKey))
        {
            SimulateCheck();
            return false;
        }

        return hasher.VerifyHashedPassword(user, user.RecoveryKeyHash, Convert.ToBase64String(recoveryAuthKey))
            != PasswordVerificationResult.Failed;
    }

    /// <summary>Spends the time of a real check, for requests about accounts that do not exist.</summary>
    public void SimulateCheck() =>
        hasher.VerifyHashedPassword(null!, _dummyHash.Value, Convert.ToBase64String(new byte[KeyDerivation.AuthKeyBytes]));
}
