using MapleNotes.Server.Features.Passkeys;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Auth;

/// <summary>Checks a step-up confirmation and records it on the session.</summary>
/// <param name="db">Database.</param>
/// <param name="credentials">Checks password proofs.</param>
/// <param name="twoFactor">Checks authenticator and recovery codes.</param>
/// <param name="passkeys">Checks passkey answers.</param>
/// <param name="sessions">Records the confirmation.</param>
/// <param name="time">Clock.</param>
public sealed class ConfirmationService(
    MapleDbContext db,
    CredentialVerifier credentials,
    TwoFactorService twoFactor,
    PasskeyService passkeys,
    SessionService sessions,
    TimeProvider time)
{
    /// <summary>
    /// Checks the confirmation and marks the session as confirmed. A wrong password or code counts toward the sign-in
    /// lockout, like the password confirmations inside a session, so a stolen session cannot guess either faster than
    /// sign-in can.
    /// </summary>
    /// <param name="userId">The signed-in account.</param>
    /// <param name="sessionId">The current session.</param>
    /// <param name="request">The confirmation.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>Until when the confirmation counts.</returns>
    /// <exception cref="ApiValidationException">The confirmation is missing, ambiguous or wrong.</exception>
    /// <exception cref="AccountLockedException">The account is locked, or this failure locked it.</exception>
    public async Task<DateTime> ConfirmAsync(Guid userId, Guid sessionId, ConfirmRequest request, CancellationToken cancellationToken)
    {
        var methods = (request.Proof is null ? 0 : 1) + (request.Code is null ? 0 : 1) + (request.Passkey is null ? 0 : 1);
        if (methods != 1)
        {
            throw new ApiValidationException("method", "Send the password, a code or a passkey's answer (exactly one).");
        }

        if (request.Passkey is not null)
        {
            if (!await passkeys.ConfirmAsync(userId, request.ChallengeId, request.Passkey, cancellationToken))
            {
                throw new ApiValidationException("passkey", "This passkey could not confirm it is you.");
            }
        }
        else
        {
            var user = await db.Users.SingleAsync(u => u.Id == userId, cancellationToken);
            var now = time.GetUtcNow().UtcDateTime;
            if (request.Proof is not null)
            {
                if (!await AccountService.ConfirmPasswordAsync(db, credentials, user, request.Proof, now, cancellationToken))
                {
                    throw new ApiValidationException("password", "The password is not correct.");
                }
            }
            else
            {
                if (user.LockoutEndUtc > now)
                {
                    throw new AccountLockedException(user.LockoutEndUtc.Value);
                }

                if (user.TwoFactorSecret is null)
                {
                    throw new ApiValidationException("code", "Two-factor sign-in is off.");
                }

                if (!twoFactor.CheckCode(user, request.Code))
                {
                    if (await AccountService.RecordFailedAttemptAsync(db, user.Id, now, cancellationToken))
                    {
                        throw new AccountLockedException(now + AccountService.LockoutDuration);
                    }

                    throw new ApiValidationException("code", "That code is not correct.");
                }
            }

            // Keeps a legacy credential upgrade, the code's step (so it cannot be used again) or a spent recovery code.
            await db.SaveChangesAsync(cancellationToken);
        }

        return await sessions.ConfirmAsync(userId, sessionId, cancellationToken)
            ?? throw new ApiValidationException("session", "This session has ended. Sign in again.");
    }
}
