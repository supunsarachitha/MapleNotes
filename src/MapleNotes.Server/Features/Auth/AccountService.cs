using System.Security.Cryptography;
using System.Text;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Auth;

/// <summary>Why an account operation did not succeed.</summary>
public enum AccountError
{
    /// <summary>The operation succeeded.</summary>
    None,

    /// <summary>Input failed validation; see <see cref="AccountResult.ValidationErrors"/>.</summary>
    InvalidInput,

    /// <summary>Registration is closed on this instance.</summary>
    RegistrationClosed,

    /// <summary>The username is already in use.</summary>
    UsernameTaken,

    /// <summary>Unknown username or wrong credential (deliberately indistinguishable).</summary>
    InvalidCredentials,

    /// <summary>Too many failed attempts; see <see cref="AccountResult.LockedUntilUtc"/>.</summary>
    LockedOut,

    /// <summary>An administrator disabled the account.</summary>
    Disabled,

    /// <summary>
    /// The account is the instance's only active administrator. Deleting it would leave the instance without one, and
    /// the next visitor could claim it by creating the first account.
    /// </summary>
    LastAdministrator,
}

/// <summary>Outcome of an account operation.</summary>
/// <param name="User">The account, when the operation succeeded.</param>
/// <param name="Error">The failure reason, or <see cref="AccountError.None"/>.</param>
/// <param name="ValidationErrors">Field errors for <see cref="AccountError.InvalidInput"/>.</param>
/// <param name="LockedUntilUtc">End of the lockout for <see cref="AccountError.LockedOut"/>.</param>
public sealed record AccountResult(
    User? User,
    AccountError Error,
    IReadOnlyDictionary<string, string[]>? ValidationErrors = null,
    DateTime? LockedUntilUtc = null)
{
    /// <summary>Whether the operation succeeded.</summary>
    public bool Succeeded => Error == AccountError.None;

    internal static AccountResult Success(User user) => new(user, AccountError.None);

    internal static AccountResult Fail(AccountError error) => new(null, error);
}

/// <summary>
/// Account operations: prelogin, registration, credential checks, password changes and session revocation.
/// </summary>
/// <remarks>
/// Sign-in is key-derived (docs/e2ee-spec.md §1): the browser turns the password into an authentication key with
/// Argon2id and the account's parameters from <see cref="GetPreloginAsync"/>, and only that key reaches the server.
/// </remarks>
/// <param name="db">Database context.</param>
/// <param name="credentials">Stores and checks credentials.</param>
/// <param name="keys">Instance keys (for prelogin pseudo-salts).</param>
/// <param name="dataKeys">Creates each new account's data key.</param>
/// <param name="instanceSettings">Instance settings (open registration).</param>
/// <param name="options">Instance settings from the environment.</param>
/// <param name="deletion">Deletes accounts with all their content.</param>
/// <param name="time">Clock.</param>
public sealed class AccountService(
    MapleDbContext db,
    CredentialVerifier credentials,
    KeyMaterial keys,
    DataKeyService dataKeys,
    InstanceSettingsService instanceSettings,
    MapleOptions options,
    AccountDeletionService deletion,
    TimeProvider time)
{
    /// <summary>Failed sign-in attempts that trigger a lockout.</summary>
    public const int MaxFailedAttempts = 5;

    /// <summary>How long a lockout lasts.</summary>
    public static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);

    /// <summary>Returns true when no account exists yet.</summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>Whether the instance still needs its first (administrator) account.</returns>
    public async Task<bool> IsSetupRequiredAsync(CancellationToken cancellationToken) =>
        !await db.Users.AnyAsync(cancellationToken);

    /// <summary>
    /// Returns the key-derivation parameters for a username, answering in the same shape whether or not the account
    /// exists.
    /// </summary>
    /// <remarks>
    /// For an unknown username the salt is <c>HMAC-SHA256(preloginKey, normalized username)</c> truncated to 16
    /// bytes: stable across requests, like a real account's salt, and unpredictable without the instance key.
    /// </remarks>
    /// <param name="username">Login name (case-insensitive).</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The parameters, and whether the account must send its password once to upgrade.</returns>
    public async Task<PreloginResponse> GetPreloginAsync(string username, CancellationToken cancellationToken)
    {
        var normalizedUsername = CredentialRules.NormalizeUsername(username);
        var account = await db.Users.AsNoTracking()
            .Where(u => u.NormalizedUsername == normalizedUsername)
            .Select(u => new { u.KdfSalt, u.KdfMemoryKiB, u.KdfIterations, u.KdfParallelism, u.CredentialFormat })
            .SingleOrDefaultAsync(cancellationToken);

        return account is null
            ? new PreloginResponse(
                new KdfParameters(
                    HMACSHA256.HashData(keys.PreloginKey, Encoding.UTF8.GetBytes(normalizedUsername))[..KeyDerivation.SaltBytes],
                    KeyDerivation.DefaultMemoryKiB,
                    KeyDerivation.DefaultIterations,
                    KeyDerivation.DefaultParallelism),
                Upgrade: false)
            : new PreloginResponse(
                new KdfParameters(account.KdfSalt, account.KdfMemoryKiB, account.KdfIterations, account.KdfParallelism),
                Upgrade: account.CredentialFormat == CredentialFormat.LegacyPassword);
    }

    /// <summary>
    /// Creates an account. The first account on an instance becomes the administrator and can always be created;
    /// later accounts require open registration.
    /// </summary>
    /// <param name="request">The requested account details.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The new account, or why it could not be created.</returns>
    public async Task<AccountResult> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken)
    {
        var errors = CredentialRules.ValidateNewAccount(request.Username, request.DisplayName);
        if (KeyDerivation.Validate(request.Kdf) is { } kdfError)
        {
            errors["kdf"] = [kdfError];
        }

        if (!KeyDerivation.IsAuthKey(request.AuthKey))
        {
            errors["authKey"] = [$"The authentication key must be {KeyDerivation.AuthKeyBytes} bytes."];
        }

        if (errors.Count > 0)
        {
            return new AccountResult(null, AccountError.InvalidInput, errors);
        }

        // An immediate (write) transaction serializes concurrent registrations, so two simultaneous sign-ups can
        // neither both become the first administrator nor both take the same username.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var isFirstUser = !await db.Users.AnyAsync(cancellationToken);
        if (!isFirstUser && !await instanceSettings.IsRegistrationOpenAsync(cancellationToken))
        {
            return AccountResult.Fail(AccountError.RegistrationClosed);
        }

        var normalizedUsername = CredentialRules.NormalizeUsername(request.Username);
        if (await db.Users.AnyAsync(u => u.NormalizedUsername == normalizedUsername, cancellationToken))
        {
            return AccountResult.Fail(AccountError.UsernameTaken);
        }

        var now = time.GetUtcNow().UtcDateTime;
        var userId = Guid.CreateVersion7();
        var username = request.Username.Trim();
        var user = new User
        {
            Id = userId,
            Username = username,
            NormalizedUsername = normalizedUsername,
            DisplayName = string.IsNullOrWhiteSpace(request.DisplayName) ? username : request.DisplayName.Trim(),
            CredentialHash = string.Empty,
            KdfSalt = request.Kdf.Salt,
            KdfMemoryKiB = request.Kdf.MemoryKiB,
            KdfIterations = request.Kdf.Iterations,
            KdfParallelism = request.Kdf.Parallelism,
            Role = isFirstUser ? UserRole.Admin : UserRole.User,
            WrappedDataKey = dataKeys.CreateWrappedKey(userId),
            EncryptionEnabled = options.DefaultEncryption,
            CreatedAtUtc = now,
            UpdatedAtUtc = now,
        };
        credentials.SetAuthKey(user, request.AuthKey);

        db.Users.Add(user);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return AccountResult.Success(user);
    }

    /// <summary>
    /// Checks sign-in credentials, applying lockout after repeated failures. A legacy account is upgraded to
    /// key-derived sign-in when the request also carries its correct password.
    /// </summary>
    /// <param name="request">Username, authentication key and, for a legacy account, the password.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The account when the credentials are valid, or why sign-in was refused.</returns>
    public async Task<AccountResult> ValidateCredentialsAsync(LoginRequest request, CancellationToken cancellationToken)
    {
        if (!KeyDerivation.IsAuthKey(request.AuthKey))
        {
            return new AccountResult(null, AccountError.InvalidInput,
                new Dictionary<string, string[]> { ["authKey"] = [$"The authentication key must be {KeyDerivation.AuthKeyBytes} bytes."] });
        }

        var normalizedUsername = CredentialRules.NormalizeUsername(request.Username);
        var user = await db.Users.SingleOrDefaultAsync(u => u.NormalizedUsername == normalizedUsername, cancellationToken);
        if (user is null)
        {
            credentials.SimulateCheck();
            return AccountResult.Fail(AccountError.InvalidCredentials);
        }

        var now = time.GetUtcNow().UtcDateTime;
        if (user.LockoutEndUtc > now)
        {
            return new AccountResult(null, AccountError.LockedOut, LockedUntilUtc: user.LockoutEndUtc);
        }

        if (!credentials.Verify(user, request.AuthKey, request.Password))
        {
            user.AccessFailedCount++;
            if (user.AccessFailedCount >= MaxFailedAttempts)
            {
                user.AccessFailedCount = 0;
                user.LockoutEndUtc = now + LockoutDuration;
            }

            await db.SaveChangesAsync(cancellationToken);
            return user.LockoutEndUtc > now
                ? new AccountResult(null, AccountError.LockedOut, LockedUntilUtc: user.LockoutEndUtc)
                : AccountResult.Fail(AccountError.InvalidCredentials);
        }

        if (user.IsDisabled)
        {
            await db.SaveChangesAsync(cancellationToken); // keeps a legacy upgrade: the credential was right
            return AccountResult.Fail(AccountError.Disabled);
        }

        user.AccessFailedCount = 0;
        user.LockoutEndUtc = null;
        await db.SaveChangesAsync(cancellationToken);
        return AccountResult.Success(user);
    }

    /// <summary>
    /// Changes a user's password (that is, their key-derivation salt and authentication key) and signs out all of
    /// their other sessions.
    /// </summary>
    /// <param name="userId">The account.</param>
    /// <param name="request">Proof of the current password, and the new parameters and key.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The updated account, or why the change was refused.</returns>
    public async Task<AccountResult> ChangePasswordAsync(Guid userId, ChangePasswordRequest request, CancellationToken cancellationToken)
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

        if (errors.Count > 0)
        {
            return new AccountResult(null, AccountError.InvalidInput, errors);
        }

        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
        if (!credentials.Verify(user, request.Current?.AuthKey, request.Current?.Password))
        {
            return new AccountResult(null, AccountError.InvalidInput,
                new Dictionary<string, string[]> { ["currentPassword"] = ["The current password is not correct."] });
        }

        user.KdfSalt = request.NewKdf.Salt;
        user.KdfMemoryKiB = request.NewKdf.MemoryKiB;
        user.KdfIterations = request.NewKdf.Iterations;
        user.KdfParallelism = request.NewKdf.Parallelism;
        credentials.SetAuthKey(user, request.NewAuthKey);
        user.SecurityStamp = User.NewSecurityStamp();
        user.UpdatedAtUtc = time.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(cancellationToken);
        return AccountResult.Success(user);
    }

    /// <summary>Invalidates every session of a user by rotating their security stamp.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>A task that completes when the stamp is saved.</returns>
    public async Task RevokeSessionsAsync(Guid userId, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
        user.SecurityStamp = User.NewSecurityStamp();
        user.UpdatedAtUtc = time.GetUtcNow().UtcDateTime;
        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Permanently deletes the user's own account, with all notes and files, after checking proof of the password.
    /// </summary>
    /// <param name="userId">The account.</param>
    /// <param name="proof">Proof of the account password.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>Success, a wrong password, or <see cref="AccountError.LastAdministrator"/>.</returns>
    public async Task<AccountResult> DeleteOwnAccountAsync(Guid userId, CredentialProof? proof, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
        if (!credentials.Verify(user, proof?.AuthKey, proof?.Password))
        {
            return new AccountResult(null, AccountError.InvalidInput,
                new Dictionary<string, string[]> { ["password"] = ["The password is not correct."] });
        }

        var otherAdministrators = await db.Users.AnyAsync(
            u => u.Id != userId && u.Role == UserRole.Admin && !u.IsDisabled, cancellationToken);
        if (user.Role == UserRole.Admin && !otherAdministrators)
        {
            await db.SaveChangesAsync(cancellationToken); // keeps a legacy upgrade: the password was right
            return AccountResult.Fail(AccountError.LastAdministrator);
        }

        await deletion.DeleteAsync(userId, cancellationToken);
        return AccountResult.Success(user);
    }

    /// <summary>Loads an account.</summary>
    /// <param name="userId">The account ID.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The account, or null if it no longer exists.</returns>
    public Task<User?> FindAsync(Guid userId, CancellationToken cancellationToken) =>
        db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);
}
