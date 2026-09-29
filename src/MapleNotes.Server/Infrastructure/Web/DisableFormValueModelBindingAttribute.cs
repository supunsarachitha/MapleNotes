using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace MapleNotes.Server.Infrastructure.Web;

/// <summary>
/// Stops MVC from reading a multipart request body into form values before the action runs.
/// </summary>
/// <remarks>
/// When an action has any bound parameter, MVC creates its value providers first, and the form value providers parse
/// the entire multipart body, buffering uploaded files. Actions that stream uploads themselves (with
/// <c>MultipartReader</c>) need the body untouched, so this filter removes those providers for the action.
/// </remarks>
[AttributeUsage(AttributeTargets.Method)]
public sealed class DisableFormValueModelBindingAttribute : Attribute, IResourceFilter
{
    /// <inheritdoc />
    public void OnResourceExecuting(ResourceExecutingContext context)
    {
        var factories = context.ValueProviderFactories;
        factories.RemoveType<FormValueProviderFactory>();
        factories.RemoveType<FormFileValueProviderFactory>();
        factories.RemoveType<JQueryFormValueProviderFactory>();
    }

    /// <inheritdoc />
    public void OnResourceExecuted(ResourceExecutedContext context)
    {
    }
}
