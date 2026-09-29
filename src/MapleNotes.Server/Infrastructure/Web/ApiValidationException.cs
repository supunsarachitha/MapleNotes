using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Infrastructure.Web;

/// <summary>
/// Thrown by services when a request is well-formed but its content is not acceptable. Converted to an HTTP 400
/// response with <see cref="ValidationProblemDetails"/> by <see cref="ApiExceptionFilter"/>.
/// </summary>
/// <param name="field">The request field (camelCase) the problem relates to.</param>
/// <param name="message">What is wrong and how to fix it.</param>
public sealed class ApiValidationException(string field, string message) : Exception(message)
{
    /// <summary>The request field the problem relates to.</summary>
    public string Field { get; } = field;
}

/// <summary>
/// Turns expected service exceptions into problem responses: <see cref="ApiValidationException"/> into HTTP 400 and
/// optimistic-concurrency conflicts (the same note or file changed at the same moment) into HTTP 409.
/// </summary>
internal sealed class ApiExceptionFilter : IExceptionFilter
{
    /// <inheritdoc />
    public void OnException(ExceptionContext context)
    {
        switch (context.Exception)
        {
            case ApiValidationException validation:
                context.Result = new BadRequestObjectResult(new ValidationProblemDetails(
                    new Dictionary<string, string[]> { [validation.Field] = [validation.Message] })
                {
                    Status = StatusCodes.Status400BadRequest,
                });
                context.ExceptionHandled = true;
                break;

            case DbUpdateConcurrencyException:
                context.Result = new ConflictObjectResult(new ProblemDetails
                {
                    Status = StatusCodes.Status409Conflict,
                    Title = "This item changed while you were saving.",
                    Detail = "Reload and try again.",
                });
                context.ExceptionHandled = true;
                break;
        }
    }
}
