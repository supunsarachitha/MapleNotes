using System.Security.Claims;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Auth;

/// <summary>Builds and reads the claims stored in the sign-in cookie.</summary>
public static class UserPrincipal
{
    /// <summary>Claim holding the account's security stamp at sign-in time.</summary>
    public const string SecurityStampClaim = "maple:security-stamp";

    /// <summary>Creates the principal stored in the sign-in cookie.</summary>
    /// <param name="user">The signed-in account.</param>
    /// <returns>A principal with the account ID, username, role and security stamp.</returns>
    public static ClaimsPrincipal Create(User user) =>
        new(new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Name, user.Username),
                new Claim(ClaimTypes.Role, user.Role.ToString()),
                new Claim(SecurityStampClaim, user.SecurityStamp),
            ],
            CookieAuthenticationDefaults.AuthenticationScheme));

    /// <summary>Returns the signed-in account's ID.</summary>
    /// <param name="principal">The current user.</param>
    /// <returns>The account ID.</returns>
    /// <exception cref="InvalidOperationException">No account is signed in.</exception>
    public static Guid GetUserId(this ClaimsPrincipal principal) =>
        Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
            ? id
            : throw new InvalidOperationException("No user is signed in.");

    /// <summary>
    /// Validates the cookie against the database on every request. Sessions end immediately when the account is
    /// deleted or disabled, or its security stamp changes (password change, "sign out everywhere"). A role change is
    /// applied to the session without signing the user out.
    /// </summary>
    /// <param name="context">The cookie validation context.</param>
    /// <returns>A task that completes when validation is done.</returns>
    public static async Task ValidateAsync(CookieValidatePrincipalContext context)
    {
        var principal = context.Principal;
        if (principal is null || !Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var userId))
        {
            context.RejectPrincipal();
            return;
        }

        var db = context.HttpContext.RequestServices.GetRequiredService<MapleDbContext>();
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == userId, context.HttpContext.RequestAborted);
        if (user is null || user.IsDisabled || user.SecurityStamp != principal.FindFirstValue(SecurityStampClaim))
        {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return;
        }

        if (principal.FindFirstValue(ClaimTypes.Role) != user.Role.ToString())
        {
            context.ReplacePrincipal(Create(user));
            context.ShouldRenew = true;
        }
    }
}
