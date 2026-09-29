using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace MapleNotes.Server.Infrastructure.Web;

/// <summary>
/// Rejects state-changing API requests (anything but GET, HEAD, OPTIONS and TRACE) that do not carry a valid
/// antiforgery token in the <c>X-XSRF-TOKEN</c> header, protecting cookie-authenticated endpoints against cross-site
/// request forgery. Actions marked <see cref="IgnoreAntiforgeryTokenAttribute"/> are exempt.
/// </summary>
/// <remarks>
/// MVC's own <c>AutoValidateAntiforgeryTokenAttribute</c> depends on the view-rendering services, which this API-only
/// application does not load; this filter performs the same check through <see cref="IAntiforgery"/>.
/// </remarks>
/// <param name="antiforgery">Antiforgery token service.</param>
internal sealed class AntiforgeryValidationFilter(IAntiforgery antiforgery) : IAsyncAuthorizationFilter
{
    /// <inheritdoc />
    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var method = context.HttpContext.Request.Method;
        if (HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method) || HttpMethods.IsTrace(method))
        {
            return;
        }

        if (context.ActionDescriptor.EndpointMetadata.OfType<IAntiforgeryMetadata>().LastOrDefault() is { RequiresValidation: false })
        {
            return;
        }

        if (context.Result is not null)
        {
            return; // an earlier filter (such as authorization) already decided the response
        }

        try
        {
            await antiforgery.ValidateRequestAsync(context.HttpContext);
        }
        catch (AntiforgeryValidationException)
        {
            context.Result = new ObjectResult(new ProblemDetails
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "Missing or invalid antiforgery token.",
                Detail = "Fetch a token from GET /api/v1/auth/antiforgery and send it in the X-XSRF-TOKEN header.",
            })
            {
                StatusCode = StatusCodes.Status400BadRequest,
            };
        }
    }
}
