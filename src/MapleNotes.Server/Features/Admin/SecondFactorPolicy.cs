using MapleNotes.Server.Domain;
using MapleNotes.Server.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Admin;

/// <summary>Which accounts must sign in with a second factor (an authenticator code or a passkey).</summary>
public enum SecondFactorRule
{
    /// <summary>Nobody has to; two-factor sign-in and passkeys stay optional. The default, so upgrading locks nobody out.</summary>
    Off = 0,

    /// <summary>Administrators must have one.</summary>
    Administrators = 1,

    /// <summary>Every account must have one.</summary>
    Everyone = 2,
}

/// <summary>
/// Applies the instance's <see cref="SecondFactorRule"/>. An account the rule covers that has neither two-factor
/// sign-in nor a passkey can still sign in, but its session reaches only the enrolment endpoints until it sets one up.
/// The check runs on every request rather than being stamped on the session at sign-in, so it takes effect at once
/// for sessions that already exist when the rule is turned on, and lifts as soon as the account enrols.
/// </summary>
/// <param name="db">Database.</param>
/// <param name="settings">Instance settings (the rule).</param>
public sealed class SecondFactorPolicy(MapleDbContext db, InstanceSettingsService settings)
{
    /// <summary>The <c>code</c> of the 403 problem a restricted session receives.</summary>
    public const string EnrolmentRequiredCode = "second_factor_enrolment_required";

    /// <summary>Returns whether <paramref name="rule"/> applies to an account with <paramref name="role"/>.</summary>
    /// <param name="rule">The rule.</param>
    /// <param name="role">The account's role.</param>
    /// <returns>True when the account must have a second factor.</returns>
    public static bool Covers(SecondFactorRule rule, UserRole role) =>
        rule == SecondFactorRule.Everyone || (rule == SecondFactorRule.Administrators && role == UserRole.Admin);

    /// <summary>Returns whether the account has a second factor: two-factor sign-in or at least one passkey.</summary>
    /// <param name="user">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>True when it has one.</returns>
    public async Task<bool> HasSecondFactorAsync(User user, CancellationToken cancellationToken) =>
        user.TwoFactorSecret is not null || await db.Passkeys.AnyAsync(p => p.UserId == user.Id, cancellationToken);

    /// <summary>Returns whether the account must set up a second factor before it can use the app.</summary>
    /// <param name="user">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>True when the rule covers it and it has no second factor.</returns>
    public async Task<bool> IsEnrolmentRequiredAsync(User user, CancellationToken cancellationToken) =>
        Covers(await settings.GetSecondFactorRuleAsync(cancellationToken), user.Role)
        && !await HasSecondFactorAsync(user, cancellationToken);

    /// <summary>Returns whether the account must set up a second factor before it can use the app.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>True when the rule covers it and it has no second factor; false for an unknown account.</returns>
    public async Task<bool> IsEnrolmentRequiredAsync(Guid userId, CancellationToken cancellationToken)
    {
        var rule = await settings.GetSecondFactorRuleAsync(cancellationToken);
        if (rule == SecondFactorRule.Off)
        {
            return false; // the common case costs one settings read and no account lookup
        }

        var account = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new { u.Role, HasTotp = u.TwoFactorSecret != null, HasPasskey = db.Passkeys.Any(p => p.UserId == u.Id) })
            .SingleOrDefaultAsync(cancellationToken);
        return account is not null && Covers(rule, account.Role) && !account.HasTotp && !account.HasPasskey;
    }
}
