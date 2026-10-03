using MapleNotes.Server.Features.Auth;

namespace MapleNotes.Server.Features.EndToEnd;

/// <summary>The account's end-to-end data key, wrapped by the browser with the key derived from the password.</summary>
/// <param name="WrappedKey">The envelope from docs/e2ee-spec.md §3 (base64); only the password can unwrap it.</param>
public sealed record E2eeKeyResponse(byte[] WrappedKey);

/// <summary>Request to switch the signed-in account to end-to-end encryption with a new data key.</summary>
/// <param name="Proof">Proof of the account password.</param>
/// <param name="WrappedKey">The new data key wrapped with the password-derived wrapping key.</param>
/// <param name="RecoveryWrappedKey">The same data key wrapped with the recovery key.</param>
/// <param name="RecoveryAuthKey">The authentication key derived from the recovery key (32 bytes).</param>
/// <param name="ModeRecord">End-to-end mode sealed with the new data key (docs/e2ee-spec.md §3a).</param>
public sealed record EnableEndToEndRequest(
    CredentialProof Proof, byte[] WrappedKey, byte[] RecoveryWrappedKey, byte[] RecoveryAuthKey, byte[]? ModeRecord = null);

/// <summary>Request to replace the recovery key of the signed-in account.</summary>
/// <param name="Proof">Proof of the account password.</param>
/// <param name="RecoveryWrappedKey">The data key wrapped with the new recovery key.</param>
/// <param name="RecoveryAuthKey">The authentication key derived from the new recovery key.</param>
public sealed record ReplaceRecoveryKeyRequest(CredentialProof Proof, byte[] RecoveryWrappedKey, byte[] RecoveryAuthKey);

/// <summary>First step of a password reset with the recovery key: fetch the data key wrapped with it.</summary>
/// <param name="Username">Login name (case-insensitive).</param>
/// <param name="RecoveryAuthKey">The authentication key derived from the recovery key.</param>
public sealed record RecoveryKeyRequest(string Username, byte[] RecoveryAuthKey);

/// <summary>What the browser needs to unwrap the data key with the recovery key.</summary>
/// <param name="UserId">The account ID, which the wrapping is bound to.</param>
/// <param name="RecoveryWrappedKey">The data key wrapped with the recovery key.</param>
public sealed record RecoveryKeyResponse(Guid UserId, byte[] RecoveryWrappedKey);

/// <summary>
/// Second step of a password reset with the recovery key: a new password and, as the old recovery key has now been
/// used, a new recovery key.
/// </summary>
/// <param name="Username">Login name (case-insensitive).</param>
/// <param name="RecoveryAuthKey">The authentication key derived from the recovery key being used.</param>
/// <param name="NewKdf">Key-derivation parameters for the new password, with a new random salt.</param>
/// <param name="NewAuthKey">The authentication key derived from the new password.</param>
/// <param name="NewWrappedKey">The data key wrapped with the new password's wrapping key.</param>
/// <param name="NewRecoveryWrappedKey">The data key wrapped with the new recovery key.</param>
/// <param name="NewRecoveryAuthKey">The authentication key derived from the new recovery key.</param>
/// <param name="TwoFactorCode">
/// For an account with two-factor sign-in: an authenticator or recovery code, since the reset signs in. Without it, a
/// right recovery key gets 401 with <c>twoFactorRequired: true</c>.
/// </param>
public sealed record ResetWithRecoveryKeyRequest(
    string Username,
    byte[] RecoveryAuthKey,
    KdfParameters NewKdf,
    byte[] NewAuthKey,
    byte[] NewWrappedKey,
    byte[] NewRecoveryWrappedKey,
    byte[] NewRecoveryAuthKey,
    string? TwoFactorCode = null);

/// <summary>The session's secret, which the browser uses to keep its unlocked key encrypted.</summary>
/// <param name="Key">32 random bytes (base64) held in the session cookie; see <c>UserPrincipal.SessionKeyClaim</c>.</param>
public sealed record SessionKeyResponse(byte[] Key);

/// <summary>Shape checks for end-to-end key material, which the server stores but cannot open.</summary>
public static class EndToEndKeys
{
    /// <summary>Size of a wrapped data key: 2-byte header, 12-byte nonce, 16-byte tag and the 32-byte key.</summary>
    public const int WrappedKeyBytes = 62;

    /// <summary>
    /// Returns true when <paramref name="wrapped"/> has the shape of a wrapped data key (docs/e2ee-spec.md §2–§3):
    /// the right length, envelope format 1 and a key version of at least 1. Whether it really wraps the account's key
    /// only the browser can tell, so the web app checks each new wrapping before sending it.
    /// </summary>
    /// <param name="wrapped">The value to check.</param>
    /// <returns>Whether it is acceptable.</returns>
    public static bool IsWrappedKey(byte[]? wrapped) => wrapped is { Length: WrappedKeyBytes } && wrapped[0] == 1 && wrapped[1] >= 1;

    /// <summary>Collects field errors for the recovery material in a request.</summary>
    /// <param name="errors">Errors so far, keyed by field.</param>
    /// <param name="wrappedField">Field name of the recovery-wrapped key.</param>
    /// <param name="wrapped">The recovery-wrapped key.</param>
    /// <param name="authField">Field name of the recovery authentication key.</param>
    /// <param name="authKey">The recovery authentication key.</param>
    public static void ValidateRecovery(Dictionary<string, string[]> errors, string wrappedField, byte[]? wrapped, string authField, byte[]? authKey)
    {
        if (!IsWrappedKey(wrapped))
        {
            errors[wrappedField] = ["This is not a wrapped end-to-end key."];
        }

        if (!KeyDerivation.IsAuthKey(authKey))
        {
            errors[authField] = [$"The recovery authentication key must be {KeyDerivation.AuthKeyBytes} bytes."];
        }
    }
}
