using MapleNotes.Server.Domain;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace MapleNotes.Server.Features.Auth;

/// <summary>Issues the session cookie.</summary>
public static class SessionSignIn
{
    /// <summary>Signs <paramref name="user"/> in on this client.</summary>
    /// <param name="context">The current request.</param>
    /// <param name="user">The account.</param>
    /// <param name="isPersistent">Keep the session for 30 days instead of until the browser closes.</param>
    /// <param name="sessionKey">
    /// The session secret to keep when re-issuing the cookie of the same session (password change); null starts a
    /// new session with a new secret.
    /// </param>
    /// <returns>A task that completes when the cookie is set.</returns>
    public static Task SignInAsync(HttpContext context, User user, bool isPersistent, string? sessionKey = null) =>
        context.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            UserPrincipal.Create(user, sessionKey),
            new AuthenticationProperties { IsPersistent = isPersistent, AllowRefresh = true });
}
