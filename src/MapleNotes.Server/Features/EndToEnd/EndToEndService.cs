using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.EndToEnd;

/// <summary>
/// Stores an account's end-to-end key material and resets passwords with the recovery key (docs/e2ee-spec.md §3, §6).
/// </summary>
/// <remarks>
/// The data key is generated, wrapped and unwrapped only in the browser. The server keeps the two wrapped copies (by
/// the password and by the recovery key) and a hash of the recovery authentication key, and it cannot open any of
/// them.
/// </remarks>
/// <param name="db">Database context.</param>
/// <param name="credentials">Checks proofs of the password and the recovery key.</param>
/// <param name="encryption">Reports conversion progress.</param>
/// <param name="signal">Wakes the background migration worker.</param>
/// <param name="time">Clock.</param>
public sealed class EndToEndService(
    MapleDbContext db,
    CredentialVerifier credentials,
    EncryptionSettingsService encryption,
    EncryptionMigrationSignal signal,
    TimeProvider time)
{
    /// <summary>Returns the account's wrapped end-to-end key.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The wrapped key, or null when the account has none.</returns>
    public Task<byte[]?> GetWrappedKeyAsync(Guid userId, CancellationToken cancellationToken) =>
        db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.E2eeWrappedKey).SingleAsync(cancellationToken);

    /// <summary>
    /// Switches the account to end-to-end encryption with a data key created in the browser. New content must then
    /// arrive encrypted; existing content stays readable and is converted by the browser.
    /// </summary>
    /// <param name="userId">The account.</param>
    /// <param name="request">Proof of the password and the wrapped keys.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The encryption status afterwards.</returns>
    /// <exception cref="ApiValidationException">The password is wrong or a key is malformed.</exception>
    /// <exception cref="ApiProblemException">The account already has an end-to-end key (HTTP 409).</exception>
    public async Task<EncryptionStatusResponse> EnableAsync(Guid userId, EnableEndToEndRequest request, CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>();
        if (!EndToEndKeys.IsWrappedKey(request.WrappedKey))
        {
            errors["wrappedKey"] = ["This is not a wrapped end-to-end key."];
        }

        EndToEndKeys.ValidateRecovery(errors, "recoveryWrappedKey", request.RecoveryWrappedKey, "recoveryAuthKey", request.RecoveryAuthKey);
        ThrowIfAny(errors);

        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
        VerifyProof(user, request.Proof);
        if (user.E2eeWrappedKey is not null)
        {
            await db.SaveChangesAsync(cancellationToken); // keeps a legacy credential upgrade
            throw new ApiProblemException(
                StatusCodes.Status409Conflict,
                "This account already has an end-to-end key.",
                "Unlock it with your password instead of creating a new one.");
        }

        user.EncryptionMode = EncryptionMode.EndToEnd;
        user.E2eeWrappedKey = request.WrappedKey;
        user.E2eeRecoveryWrappedKey = request.RecoveryWrappedKey;
        user.RecoveryKeyHash = credentials.HashRecoveryKey(user, request.RecoveryAuthKey);
        user.UpdatedAtUtc = time.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(cancellationToken);
        signal.Notify();
        return await encryption.GetStatusAsync(userId, cancellationToken);
    }

    /// <summary>Replaces the recovery key (for example after the old one was lost or exposed).</summary>
    /// <param name="userId">The account.</param>
    /// <param name="request">Proof of the password and the new recovery material.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>A task that completes when the new recovery key is saved; the old one no longer works.</returns>
    /// <exception cref="ApiValidationException">The password is wrong or a key is malformed.</exception>
    /// <exception cref="ApiProblemException">The account has no end-to-end key (HTTP 409).</exception>
    public async Task ReplaceRecoveryKeyAsync(Guid userId, ReplaceRecoveryKeyRequest request, CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>();
        EndToEndKeys.ValidateRecovery(errors, "recoveryWrappedKey", request.RecoveryWrappedKey, "recoveryAuthKey", request.RecoveryAuthKey);
        ThrowIfAny(errors);

        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
        VerifyProof(user, request.Proof);
        if (user.E2eeWrappedKey is null)
        {
            await db.SaveChangesAsync(cancellationToken);
            throw new ApiProblemException(StatusCodes.Status409Conflict, "This account has no end-to-end key.");
        }

        user.E2eeRecoveryWrappedKey = request.RecoveryWrappedKey;
        user.RecoveryKeyHash = credentials.HashRecoveryKey(user, request.RecoveryAuthKey);
        user.UpdatedAtUtc = time.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// First step of a reset with the recovery key: checks it and returns the data key wrapped with it. Unknown
    /// usernames, accounts without a recovery key and wrong keys all get the same answer.
    /// </summary>
    /// <param name="request">Username and recovery authentication key.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The account ID and recovery-wrapped key, or null.</returns>
    public async Task<RecoveryKeyResponse?> GetRecoveryKeyAsync(RecoveryKeyRequest request, CancellationToken cancellationToken)
    {
        var user = await FindAsync(request.Username, cancellationToken);
        if (user is null)
        {
            credentials.SimulateCheck();
            return null;
        }

        return credentials.VerifyRecoveryKey(user, request.RecoveryAuthKey)
            ? new RecoveryKeyResponse(user.Id, user.E2eeRecoveryWrappedKey!)
            : null;
    }

    /// <summary>
    /// Second step of a reset with the recovery key: sets the new password and recovery key and signs out every
    /// session. It also lifts a sign-in lockout, since the recovery key proves ownership.
    /// </summary>
    /// <param name="request">The recovery key being used and all new key material.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The account, or why the reset was refused.</returns>
    public async Task<AccountResult> ResetAsync(ResetWithRecoveryKeyRequest request, CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, string[]>();
        if (KeyDerivation.Validate(request.NewKdf) is { } kdfError)
        {
            errors["newKdf"] = [kdfError];
        }

        if (!KeyDerivation.IsAuthKey(request.NewAuthKey))
        {
            errors["newAuthKey"] = [$"The authentication key must be {KeyDerivation.AuthKeyBytes} bytes."];
        }

        if (!EndToEndKeys.IsWrappedKey(request.NewWrappedKey))
        {
            errors["newWrappedKey"] = ["This is not a wrapped end-to-end key."];
        }

        EndToEndKeys.ValidateRecovery(errors, "newRecoveryWrappedKey", request.NewRecoveryWrappedKey, "newRecoveryAuthKey", request.NewRecoveryAuthKey);
        if (errors.Count > 0)
        {
            return new AccountResult(null, AccountError.InvalidInput, errors);
        }

        var user = await FindAsync(request.Username, cancellationToken);
        if (user is null)
        {
            credentials.SimulateCheck();
            return AccountResult.Fail(AccountError.InvalidCredentials);
        }

        if (!credentials.VerifyRecoveryKey(user, request.RecoveryAuthKey))
        {
            return AccountResult.Fail(AccountError.InvalidCredentials);
        }

        if (user.IsDisabled)
        {
            return AccountResult.Fail(AccountError.Disabled);
        }

        user.KdfSalt = request.NewKdf.Salt;
        user.KdfMemoryKiB = request.NewKdf.MemoryKiB;
        user.KdfIterations = request.NewKdf.Iterations;
        user.KdfParallelism = request.NewKdf.Parallelism;
        credentials.SetAuthKey(user, request.NewAuthKey);
        user.E2eeWrappedKey = request.NewWrappedKey;
        user.E2eeRecoveryWrappedKey = request.NewRecoveryWrappedKey;
        user.RecoveryKeyHash = credentials.HashRecoveryKey(user, request.NewRecoveryAuthKey);
        user.SecurityStamp = User.NewSecurityStamp();
        user.AccessFailedCount = 0;
        user.LockoutEndUtc = null;
        user.UpdatedAtUtc = time.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(cancellationToken);
        return AccountResult.Success(user);
    }

    private Task<User?> FindAsync(string username, CancellationToken cancellationToken)
    {
        var normalizedUsername = CredentialRules.NormalizeUsername(username);
        return db.Users.SingleOrDefaultAsync(u => u.NormalizedUsername == normalizedUsername, cancellationToken);
    }

    private void VerifyProof(User user, CredentialProof? proof)
    {
        if (!credentials.Verify(user, proof?.AuthKey, proof?.Password))
        {
            throw new ApiValidationException("password", "The password is not correct.");
        }
    }

    private static void ThrowIfAny(Dictionary<string, string[]> errors)
    {
        if (errors.Count > 0)
        {
            var (field, messages) = errors.First();
            throw new ApiValidationException(field, messages[0]);
        }
    }
}
