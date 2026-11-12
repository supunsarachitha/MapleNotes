using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace MapleNotes.Server.Features.Auth;

/// <summary>The rules of step-up confirmation.</summary>
/// <remarks>
/// A live session alone, which may be a 30-day "keep me signed in" session or a stolen cookie, is not enough for
/// actions that take all the notes away or weaken the account or the server: those also need the person to have
/// proved they are present in the same session a few minutes earlier (signed in, or confirmed with the password, a
/// passkey or an authenticator code through <c>POST /api/v1/auth/confirm</c>).
/// </remarks>
public static class RecentConfirmation
{
    /// <summary>How long a confirmation counts.</summary>
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(10);

    /// <summary>The <c>code</c> of the 403 problem an action answers when the session has no recent confirmation.</summary>
    public const string RequiredCode = "confirmation_required";
}

/// <summary>
/// Marks an action that needs a confirmation from the last <see cref="RecentConfirmation.Window"/> in the same
/// session; without one it answers 403 with the code <see cref="RecentConfirmation.RequiredCode"/>, which the web app
/// turns into a prompt. It runs after the controller's own authorization (an account that may not use the action at
/// all is refused as before, not asked to confirm).
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class RequiresRecentConfirmationAttribute : Attribute, IAsyncAuthorizationFilter
{
    /// <inheritdoc />
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var http = context.HttpContext;
        if (context.Result is not null || http.User.Identity?.IsAuthenticated != true)
        {
            return;
        }

        if (http.User.GetSessionId() is { } sessionId
            && await http.RequestServices.GetRequiredService<SessionService>()
                .ConfirmedUntilAsync(http.User.GetUserId(), sessionId, http.RequestAborted) is not null)
        {
            return;
        }

        var problem = new ProblemDetails
        {
            Status = StatusCodes.Status403Forbidden,
            Title = "Confirm it is you to continue.",
            Detail = "Enter your password, use a passkey or enter an authenticator code, then try again.",
            Extensions = { ["code"] = RecentConfirmation.RequiredCode },
        };
        context.Result = new ObjectResult(problem) { StatusCode = StatusCodes.Status403Forbidden };
    }
}
