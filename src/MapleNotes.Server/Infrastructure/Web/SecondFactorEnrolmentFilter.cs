using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Features.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace MapleNotes.Server.Infrastructure.Web;

/// <summary>
/// Marks an endpoint that a session restricted by the second-factor rule may still use: setting up two-factor
/// sign-in or a passkey, signing out, and reading who is signed in.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class AllowDuringEnrolmentAttribute : Attribute;

/// <summary>
/// Answers 403 with the code <see cref="SecondFactorPolicy.EnrolmentRequiredCode"/> when a signed-in account must set
/// up a second factor (<see cref="SecondFactorPolicy"/>) and the endpoint is not marked
/// <see cref="AllowDuringEnrolmentAttribute"/>. Anonymous endpoints are left alone. Secure by default: an endpoint
/// added later is closed to restricted sessions unless it is marked.
/// </summary>
/// <param name="policy">The second-factor rule.</param>
internal sealed class SecondFactorEnrolmentFilter(SecondFactorPolicy policy) : IAsyncAuthorizationFilter
{
    /// <inheritdoc />
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var metadata = context.ActionDescriptor.EndpointMetadata;
        if (context.Result is not null
            || context.HttpContext.User.Identity?.IsAuthenticated != true
            || metadata.OfType<IAllowAnonymous>().Any()
            || metadata.OfType<AllowDuringEnrolmentAttribute>().Any())
        {
            return;
        }

        if (await policy.IsEnrolmentRequiredAsync(context.HttpContext.User.GetUserId(), context.HttpContext.RequestAborted))
        {
            var problem = new ProblemDetails
            {
                Status = StatusCodes.Status403Forbidden,
                Title = "Set up two-factor sign-in or a passkey to continue.",
                Detail = "This server requires a second factor for your account. Until you set one up, you can only do that or sign out.",
                Extensions = { ["code"] = SecondFactorPolicy.EnrolmentRequiredCode },
            };
            context.Result = new ObjectResult(problem) { StatusCode = StatusCodes.Status403Forbidden };
        }
    }
}
