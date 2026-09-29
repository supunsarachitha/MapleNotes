using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace MapleNotes.Server.Infrastructure.Web;

/// <summary>
/// Thrown by services when a request is well-formed but its content is not acceptable. Converted to an HTTP 400
/// response with <see cref="ValidationProblemDetails"/> by <see cref="ApiValidationExceptionFilter"/>.
/// </summary>
/// <param name="field">The request field (camelCase) the problem relates to.</param>
/// <param name="message">What is wrong and how to fix it.</param>
public sealed class ApiValidationException(string field, string message) : Exception(message)
{
    /// <summary>The request field the problem relates to.</summary>
    public string Field { get; } = field;
}

/// <summary>Turns <see cref="ApiValidationException"/> into an HTTP 400 validation problem response.</summary>
internal sealed class ApiValidationExceptionFilter : IExceptionFilter
{
    /// <inheritdoc />
    public void OnException(ExceptionContext context)
    {
        if (context.Exception is not ApiValidationException validation)
        {
            return;
        }

        var problem = new ValidationProblemDetails(new Dictionary<string, string[]> { [validation.Field] = [validation.Message] })
        {
            Status = StatusCodes.Status400BadRequest,
        };
        context.Result = new BadRequestObjectResult(problem);
        context.ExceptionHandled = true;
    }
}
