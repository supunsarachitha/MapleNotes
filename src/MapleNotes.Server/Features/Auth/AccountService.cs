using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
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

    /// <summary>Unknown username or wrong password (deliberately indistinguishable).</summary>
    InvalidCredentials,

    /// <summary>Too many failed attempts; see <see cref="AccountResult.LockedUntilUtc"/>.</summary>
    LockedOut,

    /// <summary>An administrator disabled the account.</summary>
    Disabled,
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
/// Account operations: registration, credential checks, password changes and session revocation.
/// </summary>
/// <param name="db">Database context.</param>
/// <param name="passwordHasher">Password hasher (PBKDF2-HMAC-SHA512, 210,000 iterations).</param>
/// <param name="dataKeys">Creates each new account's data key.</param>
/// <param name="instanceSettings">Instance settings (open registration).</param>
/// <param name="options">Instance settings from the environment.</param>
/// <param name="time">Clock.</param>
public sealed class AccountService(
    MapleDbContext db,
    IPasswordHasher<User> passwordHasher,
    DataKeyService dataKeys,
    InstanceSettingsService instanceSettings,
    MapleOptions options,
    TimeProvider time)
{
    /// <summary>Failed sign-in attempts that trigger a lockout.</summary>
    public const int MaxFailedAttempts = 5;

    /// <summary>How long a lockout lasts.</summary>
    public static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);

    // A real hash of a random password. Unknown usernames are checked against it so that a failed sign-in takes the
    // same time whether or not the account exists, which prevents discovering usernames by timing.
    private static readonly Lazy<string> TimingDummyHash = new(() =>
        new PasswordHasher<User>(Microsoft.Extensions.Options.Options.Create(PasswordHashing.Options))
            .HashPassword(null!, Guid.NewGuid().ToString()));

    /// <summary>Returns true when no account exists yet.</summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>Whether the instance still needs its first (administrator) account.</returns>
    public async Task<bool> IsSetupRequiredAsync(CancellationToken cancellationToken) =>
        !await db.Users.AnyAsync(cancellationToken);

    /// <summary>
    /// Creates an account. The first account on an instance becomes the administrator and can always be created;
    /// later accounts require open registration.
    /// </summary>
    /// <param name="request">The requested account details.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The new account, or why it could not be created.</returns>
    public async Task<AccountResult> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken)
    {
        var errors = CredentialRules.ValidateNewAccount(request.Username, request.Password, request.DisplayName);
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
            PasswordHash = string.Empty,
            Role = isFirstUser ? UserRole.Admin : UserRole.User,
            WrappedDataKey = dataKeys.CreateWrappedKey(userId),
            EncryptionEnabled = options.DefaultEncryption,
            CreatedAtUtc = now,
            UpdatedAtUtc = now,
        };
        user.PasswordHash = passwordHasher.HashPassword(user, request.Password);

        db.Users.Add(user);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return AccountResult.Success(user);
    }

    /// <summary>
    /// Checks a username and password, applying lockout after repeated failures.
    /// </summary>
    /// <param name="username">Login name (case-insensitive).</param>
    /// <param name="password">Password.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The account when the credentials are valid, or why sign-in was refused.</returns>
    public async Task<AccountResult> ValidateCredentialsAsync(string username, string password, CancellationToken cancellationToken)
    {
        var normalizedUsername = CredentialRules.NormalizeUsername(username);
        var user = await db.Users.SingleOrDefaultAsync(u => u.NormalizedUsername == normalizedUsername, cancellationToken);
        if (user is null)
        {
            passwordHasher.VerifyHashedPassword(null!, TimingDummyHash.Value, password);
            return AccountResult.Fail(AccountError.InvalidCredentials);
        }

        var now = time.GetUtcNow().UtcDateTime;
        if (user.LockoutEndUtc > now)
        {
            return new AccountResult(null, AccountError.LockedOut, LockedUntilUtc: user.LockoutEndUtc);
        }

        var verification = passwordHasher.VerifyHashedPassword(user, user.PasswordHash, password);
        if (verification == PasswordVerificationResult.Failed)
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
            return AccountResult.Fail(AccountError.Disabled);
        }

        if (verification == PasswordVerificationResult.SuccessRehashNeeded)
        {
            // Stored with older, weaker parameters: upgrade transparently now that the password is known.
            user.PasswordHash = passwordHasher.HashPassword(user, password);
        }

        user.AccessFailedCount = 0;
        user.LockoutEndUtc = null;
        await db.SaveChangesAsync(cancellationToken);
        return AccountResult.Success(user);
    }

    /// <summary>
    /// Changes a user's password and signs out all of their other sessions.
    /// </summary>
    /// <param name="userId">The account.</param>
    /// <param name="request">Current and new password.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The updated account, or why the change was refused.</returns>
    public async Task<AccountResult> ChangePasswordAsync(Guid userId, ChangePasswordRequest request, CancellationToken cancellationToken)
    {
        var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
        if (passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.CurrentPassword) == PasswordVerificationResult.Failed)
        {
            return new AccountResult(null, AccountError.InvalidInput,
                new Dictionary<string, string[]> { ["currentPassword"] = ["The current password is not correct."] });
        }

        if (CredentialRules.ValidatePassword(request.NewPassword) is { } error)
        {
            return new AccountResult(null, AccountError.InvalidInput,
                new Dictionary<string, string[]> { ["newPassword"] = [error] });
        }

        user.PasswordHash = passwordHasher.HashPassword(user, request.NewPassword);
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

    /// <summary>Loads an account.</summary>
    /// <param name="userId">The account ID.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The account, or null if it no longer exists.</returns>
    public Task<User?> FindAsync(Guid userId, CancellationToken cancellationToken) =>
        db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);
}
