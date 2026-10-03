using System.Security.Cryptography;
using System.Text;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Auth;

/// <summary>
/// Optional two-factor sign-in: a code from an authenticator app (TOTP), or one of ten single-use recovery codes, on
/// top of the password.
/// </summary>
/// <remarks>
/// <para>
/// The server must hold the authenticator secret itself to check codes. It keeps it sealed with a key derived from the
/// master key and bound to the account, so a copy of the database (already encrypted with SQLCipher) does not give it
/// away on its own. Recovery codes are kept only as HMACs under the same key.
/// </para>
/// <para>
/// Two-factor sign-in protects the session, not the notes: end-to-end content stays protected by the password alone,
/// as before, and the second factor adds nothing against a server that is already compromised.
/// </para>
/// </remarks>
/// <param name="db">Database context.</param>
/// <param name="credentials">Checks proofs of the password.</param>
/// <param name="keys">Instance keys.</param>
/// <param name="instanceSettings">The app's name, which authenticator apps show next to the account.</param>
/// <param name="time">Clock.</param>
public sealed class TwoFactorService(
    MapleDbContext db, CredentialVerifier credentials, KeyMaterial keys, InstanceSettingsService instanceSettings, TimeProvider time)
{
    /// <summary>How many recovery codes an account gets.</summary>
    public const int RecoveryCodeCount = 10;

    private const byte SecretWrappingVersion = 1;

    // Letters and digits that cannot be mistaken for one another when copied by hand (no 0/o, 1/l/i).
    private const string RecoveryAlphabet = "abcdefghjkmnpqrstuvwxyz23456789";

    /// <summary>Returns whether the account uses two-factor sign-in and how many recovery codes are left.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The status.</returns>
    public async Task<TwoFactorStatusResponse> GetStatusAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == userId, cancellationToken);
        return new TwoFactorStatusResponse(user.TwoFactorSecret is not null, RecoveryHashes(user).Count);
    }

    /// <summary>Creates a new secret for the account to add to an authenticator app. Nothing is saved yet.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The secret and its <c>otpauth://</c> link.</returns>
    public async Task<TwoFactorSetupResponse> CreateSetupAsync(Guid userId, CancellationToken cancellationToken)
    {
        var username = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.Username).SingleAsync(cancellationToken);
        var issuer = await instanceSettings.GetAppNameAsync(cancellationToken) ?? InstanceSettingsService.DefaultAppName;
        var secret = Totp.ToBase32(RandomNumberGenerator.GetBytes(Totp.SecretBytes));
        var label = Uri.EscapeDataString($"{issuer}:{username}");
        var uri = $"otpauth://totp/{label}?secret={secret}&issuer={Uri.EscapeDataString(issuer)}" +
            $"&algorithm=SHA1&digits={Totp.Digits}&period={Totp.StepSeconds}";
        return new TwoFactorSetupResponse(secret, uri);
    }

    /// <summary>
    /// Turns on two-factor sign-in with a secret the owner added to an authenticator app, once a code from the app shows
    /// it was added correctly.
    /// </summary>
    /// <param name="userId">The account.</param>
    /// <param name="request">Proof of the password, the secret and a current code.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The account, and its new recovery codes to show once.</returns>
    /// <exception cref="ApiValidationException">The password or code is wrong, the secret is malformed, or two-factor
    /// sign-in is already on.</exception>
    public async Task<(User User, RecoveryCodesResponse Codes)> EnableAsync(
        Guid userId, EnableTwoFactorRequest request, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
        await ProvePasswordAsync(user, request.Proof, cancellationToken);
        if (user.TwoFactorSecret is not null)
        {
            throw new ApiValidationException("secret", "Two-factor sign-in is already on.");
        }

        var secret = Totp.FromBase32(request.Secret);
        if (secret is not { Length: >= 16 and <= 64 })
        {
            throw new ApiValidationException("secret", "This is not an authenticator secret.");
        }

        if (Totp.Match(secret, request.Code ?? "", time.GetUtcNow(), lastUsedStep: 0) is not { } step)
        {
            throw new ApiValidationException("code", "That code is not correct. Check the time on the device with the app.");
        }

        user.TwoFactorSecret = AeadEnvelope.Seal(keys.TwoFactorKey, SecretWrappingVersion, secret, SecretContext(user.Id));
        user.TwoFactorLastStep = step;
        var codes = NewRecoveryCodes(user);

        // Sessions started with the password alone end: someone who signed in with a stolen password is signed out.
        user.SecurityStamp = User.NewSecurityStamp();
        user.UpdatedAtUtc = time.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(cancellationToken);
        return (user, codes);
    }

    /// <summary>Turns two-factor sign-in off, with proof of the password and a code.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="request">Proof of the password and an authenticator or recovery code.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>A task that completes when the change is saved.</returns>
    /// <exception cref="ApiValidationException">The password or code is wrong, or two-factor sign-in is off.</exception>
    public async Task DisableAsync(Guid userId, TwoFactorConfirmation request, CancellationToken cancellationToken)
    {
        var user = await ConfirmBothFactorsAsync(userId, request, cancellationToken);
        Clear(user);
        user.UpdatedAtUtc = time.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>Replaces the recovery codes, with proof of the password and a code.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="request">Proof of the password and an authenticator or recovery code.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The new codes; the old ones stop working.</returns>
    /// <exception cref="ApiValidationException">The password or code is wrong, or two-factor sign-in is off.</exception>
    public async Task<RecoveryCodesResponse> ReplaceRecoveryCodesAsync(
        Guid userId, TwoFactorConfirmation request, CancellationToken cancellationToken)
    {
        var user = await ConfirmBothFactorsAsync(userId, request, cancellationToken);
        var codes = NewRecoveryCodes(user);
        user.UpdatedAtUtc = time.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(cancellationToken);
        return codes;
    }

    /// <summary>
    /// Checks a second-factor code: an authenticator code for a step after the last one used, or an unused recovery code,
    /// which is then used up. The caller saves the account.
    /// </summary>
    /// <param name="user">An account with two-factor sign-in on, tracked by the context.</param>
    /// <param name="code">The code typed.</param>
    /// <returns>Whether the code is right.</returns>
    public bool CheckCode(User user, string? code)
    {
        if (user.TwoFactorSecret is null || string.IsNullOrWhiteSpace(code) || code.Length > 64)
        {
            return false;
        }

        var secret = AeadEnvelope.Open(keys.TwoFactorKey, user.TwoFactorSecret, SecretContext(user.Id));
        try
        {
            if (Totp.Match(secret, code.Trim(), time.GetUtcNow(), user.TwoFactorLastStep) is { } step)
            {
                user.TwoFactorLastStep = step;
                return true;
            }
        }
        finally
        {
            CryptographicOperations.ZeroMemory(secret);
        }

        var hashes = RecoveryHashes(user);
        var hash = RecoveryHash(code);
        if (!hashes.Remove(hash))
        {
            return false;
        }

        user.TwoFactorRecoveryCodes = string.Join(' ', hashes);
        return true;
    }

    /// <summary>Turns two-factor sign-in off without a code: an administrator's help for an owner who lost both factors.</summary>
    /// <param name="user">The account; the caller saves it.</param>
    public static void Clear(User user)
    {
        user.TwoFactorSecret = null;
        user.TwoFactorLastStep = 0;
        user.TwoFactorRecoveryCodes = null;
    }

    private async Task<User> ConfirmBothFactorsAsync(Guid userId, TwoFactorConfirmation request, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
        await ProvePasswordAsync(user, request.Proof, cancellationToken);
        if (user.TwoFactorSecret is null)
        {
            throw new ApiValidationException("code", "Two-factor sign-in is off.");
        }

        if (!CheckCode(user, request.Code))
        {
            throw new ApiValidationException("code", "That code is not correct.");
        }

        return user;
    }

    private async Task ProvePasswordAsync(User user, CredentialProof? proof, CancellationToken cancellationToken)
    {
        if (!credentials.Verify(user, proof?.AuthKey, proof?.Password))
        {
            throw new ApiValidationException("password", "The password is not correct.");
        }

        await db.SaveChangesAsync(cancellationToken); // keeps a legacy credential upgrade: the password was right
    }

    private RecoveryCodesResponse NewRecoveryCodes(User user)
    {
        var codes = Enumerable.Range(0, RecoveryCodeCount).Select(_ => NewRecoveryCode()).ToList();
        user.TwoFactorRecoveryCodes = string.Join(' ', codes.Select(RecoveryHash));
        return new RecoveryCodesResponse(codes);
    }

    private static string NewRecoveryCode()
    {
        var chars = new char[10];
        for (var i = 0; i < chars.Length; i++)
        {
            chars[i] = RecoveryAlphabet[RandomNumberGenerator.GetInt32(RecoveryAlphabet.Length)];
        }

        return $"{new string(chars, 0, 5)}-{new string(chars, 5, 5)}";
    }

    // Codes are compared without case, spaces or dashes, the way people copy them.
    private string RecoveryHash(string code)
    {
        var normalized = new string(code.Where(c => c is not (' ' or '-')).Select(char.ToLowerInvariant).ToArray());
        return Convert.ToHexStringLower(HMACSHA256.HashData(keys.TwoFactorKey, Encoding.UTF8.GetBytes(normalized)));
    }

    private static List<string> RecoveryHashes(User user) =>
        user.TwoFactorRecoveryCodes?.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList() ?? [];

    private static byte[] SecretContext(Guid userId) => Encoding.UTF8.GetBytes($"maple-notes/v1/totp/{userId:N}");
}
