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
    /// Checks a second-factor code and uses it up: an authenticator code for a step after the last one used, or an
    /// unused recovery code.
    /// </summary>
    /// <remarks>
    /// The code is spent in the database straight away, by one conditional update (the stored step is still older, or
    /// the stored list still holds the code), so requests sending the same code at the same moment cannot all pass: the
    /// ones that lose the race get false, exactly as for a wrong code. The tracked <paramref name="user"/> is brought up
    /// to date and its spent fields marked unchanged, so a later save of the account does not write them again.
    /// </remarks>
    /// <param name="user">An account with two-factor sign-in on, tracked by the context.</param>
    /// <param name="code">The code typed.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>Whether the code is right and was not used before.</returns>
    public async Task<bool> SpendCodeAsync(User user, string? code, CancellationToken cancellationToken)
    {
        if (user.TwoFactorSecret is null || string.IsNullOrWhiteSpace(code) || code.Length > 64)
        {
            return false;
        }

        long? step;
        var secret = AeadEnvelope.Open(keys.TwoFactorKey, user.TwoFactorSecret, SecretContext(user.Id));
        try
        {
            step = Totp.Match(secret, code.Trim(), time.GetUtcNow(), user.TwoFactorLastStep);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(secret);
        }

        if (step is { } matched)
        {
            var spent = await db.Users
                .Where(u => u.Id == user.Id && u.TwoFactorSecret != null && u.TwoFactorLastStep < matched)
                .ExecuteUpdateAsync(set => set.SetProperty(u => u.TwoFactorLastStep, matched), cancellationToken);
            if (spent != 1)
            {
                return false; // another request used this step (or a later one) first
            }

            MarkSaved(user, nameof(User.TwoFactorLastStep), matched);
            return true;
        }

        // Another request may use a different recovery code at the same moment and change the list under us: read it
        // again and retry a few times, so a right code is not refused for that. Losing to the same code ends the loop,
        // because the reread list no longer holds it.
        var hash = RecoveryHash(code);
        var stored = user.TwoFactorRecoveryCodes;
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var hashes = RecoveryHashes(stored);
            if (!hashes.Remove(hash))
            {
                return false;
            }

            var remaining = string.Join(' ', hashes);
            var spent = await db.Users
                .Where(u => u.Id == user.Id && u.TwoFactorSecret != null && u.TwoFactorRecoveryCodes == stored)
                .ExecuteUpdateAsync(set => set.SetProperty(u => u.TwoFactorRecoveryCodes, remaining), cancellationToken);
            if (spent == 1)
            {
                MarkSaved(user, nameof(User.TwoFactorRecoveryCodes), remaining);
                return true;
            }

            stored = await db.Users.AsNoTracking().Where(u => u.Id == user.Id && u.TwoFactorSecret != null)
                .Select(u => u.TwoFactorRecoveryCodes).SingleOrDefaultAsync(cancellationToken);
        }

        return false;
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

        if (!await SpendCodeAsync(user, request.Code, cancellationToken))
        {
            throw new ApiValidationException("code", "That code is not correct.");
        }

        return user;
    }

    private async Task ProvePasswordAsync(User user, CredentialProof? proof, CancellationToken cancellationToken)
    {
        if (!await AccountService.ConfirmPasswordAsync(db, credentials, user, proof, time.GetUtcNow().UtcDateTime, cancellationToken))
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

    private static List<string> RecoveryHashes(User user) => RecoveryHashes(user.TwoFactorRecoveryCodes);

    private static List<string> RecoveryHashes(string? stored) =>
        stored?.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList() ?? [];

    // Records on the tracked account a value already written by ExecuteUpdate, as saved, so the next SaveChanges
    // neither writes it again nor overwrites it with the value read before.
    private void MarkSaved<T>(User user, string property, T value)
    {
        var entry = db.Entry(user).Property(property);
        entry.CurrentValue = value;
        entry.OriginalValue = value;
        entry.IsModified = false;
    }

    private static byte[] SecretContext(Guid userId) => Encoding.UTF8.GetBytes($"maple-notes/v1/totp/{userId:N}");
}
