using MapleNotes.Server.Domain;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace MapleNotes.Server.Features.Auth;

/// <summary>Issues and ends the session cookie together with its server-side session.</summary>
public static class SessionSignIn
{
    /// <summary>Signs <paramref name="user"/> in on this client with a new session and a new session secret.</summary>
    /// <param name="context">The current request.</param>
    /// <param name="user">The account.</param>
    /// <param name="isPersistent">Keep the cookie when the browser closes instead of until it closes.</param>
    /// <returns>A task that completes when the session is stored and the cookie is set.</returns>
    public static async Task SignInAsync(HttpContext context, User user, bool isPersistent)
    {
        var session = await context.RequestServices.GetRequiredService<SessionService>()
            .StartAsync(context, user, context.RequestAborted);
        await context.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            UserPrincipal.Create(user, session.Id),
            new AuthenticationProperties { IsPersistent = isPersistent, AllowRefresh = true });
    }

    /// <summary>
    /// Issues the current session's cookie again after the account changed (a new security stamp after a password
    /// change), keeping the same session, persistence and secret, so a key this browser saved stays usable.
    /// </summary>
    /// <param name="context">The current, signed-in request.</param>
    /// <param name="user">The account, as saved.</param>
    /// <param name="sessionKey">A new session secret, or null to keep the current one.</param>
    /// <returns>A task that completes when the cookie is set.</returns>
    /// <exception cref="InvalidOperationException">The request has no server-side session.</exception>
    public static async Task ReissueAsync(HttpContext context, User user, string? sessionKey = null)
    {
        var sessionId = context.User.GetSessionId() ?? throw new InvalidOperationException("The request has no session.");
        await context.RequestServices.GetRequiredService<SessionService>().ReissueAsync(sessionId, user, context.RequestAborted);
        var current = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        await context.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            UserPrincipal.Create(user, sessionId, sessionKey ?? context.User.GetSessionKey()),
            new AuthenticationProperties { IsPersistent = current.Properties?.IsPersistent ?? false, AllowRefresh = true });
    }

    /// <summary>
    /// Signs this client out: deletes its server-side session, so a copy of the cookie stops working too, and clears
    /// the cookie. The session secret goes with the session, so a key this browser saved under it can no longer be
    /// opened.
    /// </summary>
    /// <param name="context">The current request (signed in or not).</param>
    /// <returns>A task that completes when the session is gone.</returns>
    public static async Task SignOutAsync(HttpContext context)
    {
        if (context.User.Identity?.IsAuthenticated == true && context.User.GetSessionId() is { } sessionId)
        {
            await context.RequestServices.GetRequiredService<SessionService>()
                .EndAsync(context.User.GetUserId(), sessionId, context.RequestAborted);
        }

        await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    }
}
