using System.Security.Claims;
using System.Security.Cryptography;
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

    /// <summary>Claim holding the ID of the server-side session (<see cref="Session"/>) the cookie belongs to.</summary>
    public const string SessionIdClaim = "maple:session-id";

    /// <summary>
    /// Claim holding the session's random 256-bit secret (base64). The browser keeps its unlocked end-to-end key
    /// encrypted under this secret, which only a valid session can fetch (<c>GET /api/v1/auth/session-key</c>): the
    /// copy saved in the browser is useless once the session ends, and the server alone has nothing to decrypt.
    /// </summary>
    public const string SessionKeyClaim = "maple:session-key";

    /// <summary>Creates the principal stored in the sign-in cookie.</summary>
    /// <param name="user">The signed-in account.</param>
    /// <param name="sessionId">The server-side session.</param>
    /// <param name="sessionKey">The session secret to keep (base64), or null for a new session with a new one.</param>
    /// <returns>A principal with the account ID, username, role, security stamp, session ID and session secret.</returns>
    public static ClaimsPrincipal Create(User user, Guid sessionId, string? sessionKey = null) =>
        new(new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Name, user.Username),
                new Claim(ClaimTypes.Role, user.Role.ToString()),
                new Claim(SecurityStampClaim, user.SecurityStamp),
                new Claim(SessionIdClaim, sessionId.ToString()),
                new Claim(SessionKeyClaim, sessionKey ?? Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))),
            ],
            CookieAuthenticationDefaults.AuthenticationScheme));

    /// <summary>Returns the session secret, or null for a session created before version 1.1.</summary>
    /// <param name="principal">The current user.</param>
    /// <returns>The base64 secret, or null.</returns>
    public static string? GetSessionKey(this ClaimsPrincipal principal) => principal.FindFirstValue(SessionKeyClaim);

    /// <summary>Returns the server-side session's ID, or null for a cookie issued before version 1.22.</summary>
    /// <param name="principal">The current user.</param>
    /// <returns>The session ID, or null.</returns>
    public static Guid? GetSessionId(this ClaimsPrincipal principal) =>
        Guid.TryParse(principal.FindFirstValue(SessionIdClaim), out var id) ? id : null;

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
    /// deleted or disabled, its security stamp changes (password change, "sign out everywhere"), or its server-side
    /// session is gone (signed out, ended from another device, past its absolute lifetime). A role change is applied
    /// to the session without signing the user out.
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

        var sessions = context.HttpContext.RequestServices.GetRequiredService<SessionService>();
        if (principal.GetSessionId() is not { } sessionId)
        {
            // A cookie from before server-side sessions: it gets a session now (its absolute lifetime counting from
            // here), so upgrading signs nobody out and the browser shows up in the device list.
            // The cookie is issued again at once rather than through sliding renewal, which skips tickets without
            // issue and expiry times; otherwise each request would start yet another session.
            var session = await sessions.StartAsync(context.HttpContext, user, context.HttpContext.RequestAborted, confirmed: false);
            var migrated = Create(user, session.Id, principal.GetSessionKey());
            await context.HttpContext.SignInAsync(
                CookieAuthenticationDefaults.AuthenticationScheme,
                migrated,
                new AuthenticationProperties { IsPersistent = context.Properties.IsPersistent, AllowRefresh = true });
            context.ReplacePrincipal(migrated);
            return;
        }

        if (!await sessions.ValidateAsync(sessionId, user, context.HttpContext, context.HttpContext.RequestAborted))
        {
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return;
        }

        if (principal.FindFirstValue(ClaimTypes.Role) != user.Role.ToString())
        {
            context.ReplacePrincipal(Create(user, sessionId, principal.GetSessionKey()));
            context.ShouldRenew = true;
        }
    }
}
