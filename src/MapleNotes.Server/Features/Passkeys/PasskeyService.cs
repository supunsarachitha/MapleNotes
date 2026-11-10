using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.EndToEnd;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Passkeys;

/// <summary>Adding, listing and removing passkeys, and signing in with one.</summary>
/// <param name="db">Database.</param>
/// <param name="credentials">Password proof checks.</param>
/// <param name="challenges">One-time challenges.</param>
/// <param name="time">Clock.</param>
public sealed class PasskeyService(MapleDbContext db, CredentialVerifier credentials, PasskeyChallenges challenges, TimeProvider time)
{
    /// <summary>How long the browser waits for the authenticator, in milliseconds.</summary>
    public const int TimeoutMs = 120_000;

    /// <summary>Lists the account's passkeys, oldest first.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the query.</param>
    /// <returns>The passkeys.</returns>
    public async Task<IReadOnlyList<PasskeyResponse>> ListAsync(Guid userId, CancellationToken cancellationToken) =>
        await db.Passkeys.AsNoTracking()
            .Where(p => p.UserId == userId)
            .OrderBy(p => p.CreatedAtUtc).ThenBy(p => p.Id)
            .Select(p => new PasskeyResponse(p.Id, p.Name, p.BackedUp, p.CreatedAtUtc, p.LastUsedAtUtc, p.CredentialId, p.E2eeWrappedKey != null))
            .ToListAsync(cancellationToken);

    /// <summary>Issues options to create a passkey for the account.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="rpId">The RP ID.</param>
    /// <param name="origin">The expected origin.</param>
    /// <param name="appName">The app's name, shown by the authenticator.</param>
    /// <param name="cancellationToken">Cancels the query.</param>
    /// <returns>The options.</returns>
    public async Task<PasskeyCreationOptions> CreateOptionsAsync(
        Guid userId, string rpId, string origin, string appName, CancellationToken cancellationToken)
    {
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == userId, cancellationToken);
        var existing = await db.Passkeys.AsNoTracking().Where(p => p.UserId == userId)
            .Select(p => new { p.CredentialId, p.Transports }).ToListAsync(cancellationToken);
        if (existing.Count >= Passkey.MaxPerAccount)
        {
            throw new ApiValidationException("passkey", $"An account can have at most {Passkey.MaxPerAccount} passkeys.");
        }

        var (id, ceremony) = challenges.Issue(PasskeyChallenges.Purpose.Register, userId, rpId, origin);
        return new PasskeyCreationOptions(
            id,
            ceremony.Challenge,
            new RelyingParty(rpId, appName),
            new PasskeyUser(UserHandle(userId), user.Username, user.DisplayName),
            WebAuthn.Algorithms,
            existing.Select(p => new CredentialDescriptor(p.CredentialId, SplitTransports(p.Transports))).ToList(),
            TimeoutMs);
    }

    /// <summary>Checks and stores a new passkey.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="request">Proof of the password, the challenge handle and the new passkey.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The stored passkey.</returns>
    /// <exception cref="ApiValidationException">The password, the challenge or the passkey is not valid.</exception>
    public async Task<PasskeyResponse> AddAsync(Guid userId, AddPasskeyRequest request, CancellationToken cancellationToken)
    {
        // Taken first, so a wrong password also uses it up: every attempt needs fresh options.
        var ceremony = challenges.Take(request.ChallengeId, PasskeyChallenges.Purpose.Register, userId);
        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
        if (!await AccountService.ConfirmPasswordAsync(db, credentials, user, request.Proof, time.GetUtcNow().UtcDateTime, cancellationToken))
        {
            throw new ApiValidationException("password", "The password is not correct.");
        }

        await db.SaveChangesAsync(cancellationToken); // keeps a legacy credential upgrade: the password was right
        if (ceremony is null)
        {
            throw new ApiValidationException("passkey", "The passkey request has expired. Try again.");
        }

        var name = CleanName(request.Name);
        var credential = request.Credential ?? throw new ApiValidationException("credential", "The passkey is missing.");
        WebAuthn.AuthenticatorData data;
        try
        {
            data = WebAuthn.VerifyRegistration(
                ceremony, credential.Id ?? [], credential.ClientDataJson ?? [], credential.AuthenticatorData ?? [],
                credential.PublicKey ?? [], credential.PublicKeyAlgorithm);
        }
        catch (WebAuthnException ex)
        {
            throw new ApiValidationException("passkey", ex.Message);
        }

        if (await db.Passkeys.CountAsync(p => p.UserId == userId, cancellationToken) >= Passkey.MaxPerAccount)
        {
            throw new ApiValidationException("passkey", $"An account can have at most {Passkey.MaxPerAccount} passkeys.");
        }

        if (await db.Passkeys.AnyAsync(p => p.CredentialId == credential.Id, cancellationToken))
        {
            throw new ApiValidationException("passkey", "This passkey has already been added.");
        }

        var passkey = new Passkey
        {
            UserId = userId,
            CredentialId = credential.Id!,
            PublicKey = credential.PublicKey!,
            Algorithm = credential.PublicKeyAlgorithm,
            SignCount = data.SignCount,
            Name = name ?? $"Passkey {await db.Passkeys.CountAsync(p => p.UserId == userId, cancellationToken) + 1}",
            BackedUp = data.BackedUp,
            Transports = JoinTransports(credential.Transports),
            CreatedAtUtc = time.GetUtcNow().UtcDateTime,
        };
        db.Passkeys.Add(passkey);
        await db.SaveChangesAsync(cancellationToken);
        return ToResponse(passkey);
    }

    /// <summary>Renames a passkey.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="id">The passkey.</param>
    /// <param name="request">The new name.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The passkey, or null when the account has no such passkey.</returns>
    public async Task<PasskeyResponse?> RenameAsync(Guid userId, Guid id, RenamePasskeyRequest request, CancellationToken cancellationToken)
    {
        var passkey = await db.Passkeys.SingleOrDefaultAsync(p => p.Id == id && p.UserId == userId, cancellationToken);
        if (passkey is null)
        {
            return null;
        }

        passkey.Name = CleanName(request.Name) ?? throw new ApiValidationException("name", "Enter a name.");
        await db.SaveChangesAsync(cancellationToken);
        return ToResponse(passkey);
    }

    /// <summary>Removes a passkey after proof of the password.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="id">The passkey.</param>
    /// <param name="request">Proof of the password.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>False when the account has no such passkey.</returns>
    public async Task<bool> RemoveAsync(Guid userId, Guid id, RemovePasskeyRequest request, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
        if (!await AccountService.ConfirmPasswordAsync(db, credentials, user, request.Proof, time.GetUtcNow().UtcDateTime, cancellationToken))
        {
            throw new ApiValidationException("password", "The password is not correct.");
        }

        var passkey = await db.Passkeys.SingleOrDefaultAsync(p => p.Id == id && p.UserId == userId, cancellationToken);
        if (passkey is not null)
        {
            db.Passkeys.Remove(passkey);
        }

        await db.SaveChangesAsync(cancellationToken);
        return passkey is not null;
    }

    /// <summary>Stores the data key wrapped for a passkey, after proof of the password.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="id">The passkey.</param>
    /// <param name="request">Proof of the password and the wrapped key.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The passkey, or null when the account has no such passkey.</returns>
    /// <exception cref="ApiValidationException">The password is wrong, the account has no end-to-end key, or the key is malformed.</exception>
    public async Task<PasskeyResponse?> SetUnlockKeyAsync(Guid userId, Guid id, PasskeyUnlockRequest request, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
        if (!await AccountService.ConfirmPasswordAsync(db, credentials, user, request.Proof, time.GetUtcNow().UtcDateTime, cancellationToken))
        {
            throw new ApiValidationException("password", "The password is not correct.");
        }

        await db.SaveChangesAsync(cancellationToken); // keeps a legacy credential upgrade: the password was right
        if (user.E2eeWrappedKey is null)
        {
            throw new ApiValidationException("wrappedKey", "This account has no end-to-end key.");
        }

        if (!EndToEndKeys.IsWrappedKey(request.WrappedKey))
        {
            throw new ApiValidationException("wrappedKey", "This is not a wrapped end-to-end key.");
        }

        var passkey = await db.Passkeys.SingleOrDefaultAsync(p => p.Id == id && p.UserId == userId, cancellationToken);
        if (passkey is null)
        {
            return null;
        }

        passkey.E2eeWrappedKey = request.WrappedKey;
        await db.SaveChangesAsync(cancellationToken);
        return ToResponse(passkey);
    }

    /// <summary>Lists the account's passkeys that unlock the notes, with their wrapped keys.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the query.</param>
    /// <returns>The keys.</returns>
    public async Task<IReadOnlyList<PasskeyUnlockKey>> ListUnlockKeysAsync(Guid userId, CancellationToken cancellationToken) =>
        await db.Passkeys.AsNoTracking()
            .Where(p => p.UserId == userId && p.E2eeWrappedKey != null)
            .OrderBy(p => p.CreatedAtUtc).ThenBy(p => p.Id)
            .Select(p => new PasskeyUnlockKey(p.Id, p.CredentialId, p.E2eeWrappedKey!))
            .ToListAsync(cancellationToken);

    /// <summary>Issues options to sign in with any passkey for this site.</summary>
    /// <param name="rpId">The RP ID.</param>
    /// <param name="origin">The expected origin.</param>
    /// <returns>The options.</returns>
    public PasskeyRequestOptions RequestOptions(string rpId, string origin)
    {
        var (id, ceremony) = challenges.Issue(PasskeyChallenges.Purpose.SignIn, null, rpId, origin);
        return new PasskeyRequestOptions(id, ceremony.Challenge, rpId, TimeoutMs);
    }

    /// <summary>Checks a passkey's answer and returns the account it signs in to.</summary>
    /// <param name="request">The challenge handle and the answer.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The account and the passkey, or the reason it was refused.</returns>
    public async Task<(AccountResult Result, Passkey? Passkey)> SignInAsync(PasskeyLoginRequest request, CancellationToken cancellationToken)
    {
        var ceremony = challenges.Take(request.ChallengeId, PasskeyChallenges.Purpose.SignIn, null);
        var assertion = request.Credential;
        if (ceremony is null || assertion?.Id is not { Length: > 0 and <= Passkey.MaxCredentialIdBytes })
        {
            return (AccountResult.Fail(AccountError.InvalidCredentials), null);
        }

        var passkey = await db.Passkeys.SingleOrDefaultAsync(p => p.CredentialId == assertion.Id, cancellationToken);
        if (passkey is null)
        {
            return (AccountResult.Fail(AccountError.InvalidCredentials), null);
        }

        if (assertion.UserHandle is { } handle && !handle.AsSpan().SequenceEqual(UserHandle(passkey.UserId)))
        {
            return (AccountResult.Fail(AccountError.InvalidCredentials), null);
        }

        WebAuthn.AuthenticatorData data;
        try
        {
            data = WebAuthn.VerifyAssertion(
                ceremony, assertion.ClientDataJson ?? [], assertion.AuthenticatorData ?? [], assertion.Signature ?? [],
                passkey.PublicKey, passkey.Algorithm);
        }
        catch (WebAuthnException)
        {
            return (AccountResult.Fail(AccountError.InvalidCredentials), null);
        }

        if (!WebAuthn.CounterAdvanced(passkey.SignCount, data.SignCount))
        {
            return (AccountResult.Fail(AccountError.InvalidCredentials), null);
        }

        var user = await db.Users.SingleAsync(u => u.Id == passkey.UserId, cancellationToken);
        if (user.IsDisabled)
        {
            return (new AccountResult(user, AccountError.Disabled), null); // the user only names the account in the audit log
        }

        passkey.SignCount = data.SignCount;
        passkey.BackedUp = data.BackedUp;
        passkey.LastUsedAtUtc = time.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(cancellationToken);
        return (AccountResult.Success(user), passkey);
    }

    /// <summary>The WebAuthn user handle of an account: its ID as 16 bytes, which says nothing about the person.</summary>
    /// <param name="userId">The account.</param>
    /// <returns>The handle.</returns>
    public static byte[] UserHandle(Guid userId) => userId.ToByteArray(bigEndian: true);

    private static PasskeyResponse ToResponse(Passkey p) => new(p.Id, p.Name, p.BackedUp, p.CreatedAtUtc, p.LastUsedAtUtc, p.CredentialId, p.E2eeWrappedKey != null);

    private static string? CleanName(string? name)
    {
        var trimmed = name?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        if (trimmed.Length > Passkey.MaxNameLength || trimmed.Any(char.IsControl))
        {
            throw new ApiValidationException("name", $"Use at most {Passkey.MaxNameLength} characters, without line breaks.");
        }

        return trimmed;
    }

    private static readonly string[] KnownTransports = ["usb", "nfc", "ble", "smart-card", "hybrid", "internal"];

    private static string? JoinTransports(IReadOnlyList<string>? transports)
    {
        var known = transports?.Where(t => KnownTransports.Contains(t, StringComparer.Ordinal)).Distinct().ToList();
        return known is { Count: > 0 } ? string.Join(',', known) : null;
    }

    private static List<string>? SplitTransports(string? transports) => transports?.Split(',').ToList();
}
