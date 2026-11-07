using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.Push;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace MapleNotes.Server.Features.Reminders;

/// <summary>Reminders on notes, and the devices that receive them as push notifications.</summary>
/// <param name="reminders">Reminder operations.</param>
/// <param name="push">Push subscriptions and sending.</param>
[ApiController]
[Authorize]
[Produces("application/json")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class RemindersController(ReminderService reminders, PushService push) : ControllerBase
{
    /// <summary>Lists the reminders on notes that are neither archived nor in the trash, soonest first.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The reminders.</returns>
    /// <response code="200">The reminders.</response>
    [HttpGet("api/v1/reminders")]
    [ProducesResponseType<IReadOnlyList<ReminderResponse>>(StatusCodes.Status200OK)]
    public Task<IReadOnlyList<ReminderResponse>> List(CancellationToken cancellationToken) =>
        reminders.ListAsync(User.GetUserId(), cancellationToken);

    /// <summary>Sets or replaces a note's reminder (notes and quick notes only).</summary>
    /// <param name="id">The note.</param>
    /// <param name="request">The local date and time, its time zone, and how it repeats.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The reminder.</returns>
    /// <response code="200">Saved.</response>
    /// <response code="400">The time has passed, or a field is invalid.</response>
    /// <response code="404">No such note, or it is in the trash.</response>
    [HttpPut("api/v1/notes/{id:guid}/reminder")]
    [ProducesResponseType<ReminderResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ReminderResponse>> Set(Guid id, SetReminderRequest request, CancellationToken cancellationToken) =>
        await reminders.SetAsync(User.GetUserId(), id, request, cancellationToken) is (SetReminderResult.Saved, { } reminder)
            ? reminder
            : NotFound();

    /// <summary>Removes a note's reminder.</summary>
    /// <param name="id">The note.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>No content.</returns>
    /// <response code="204">Removed.</response>
    /// <response code="404">The note has no reminder.</response>
    [HttpDelete("api/v1/notes/{id:guid}/reminder")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Remove(Guid id, CancellationToken cancellationToken) =>
        await reminders.RemoveAsync(User.GetUserId(), id, cancellationToken) ? NoContent() : NotFound();

    /// <summary>The server's public VAPID key, which browsers subscribe with.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The key (base64url).</returns>
    /// <response code="200">The key.</response>
    [HttpGet("api/v1/push/key")]
    [ProducesResponseType<PushKeyResponse>(StatusCodes.Status200OK)]
    public async Task<PushKeyResponse> Key(CancellationToken cancellationToken) => new(await push.GetPublicKeyAsync(cancellationToken));

    /// <summary>Lists the devices that receive the account's notifications.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The devices, newest first.</returns>
    /// <response code="200">The devices.</response>
    [HttpGet("api/v1/account/push-subscriptions")]
    [ProducesResponseType<IReadOnlyList<PushSubscriptionResponse>>(StatusCodes.Status200OK)]
    public Task<IReadOnlyList<PushSubscriptionResponse>> Devices(CancellationToken cancellationToken) =>
        push.ListAsync(User.GetUserId(), cancellationToken);

    /// <summary>Turns notifications on for this device (or renews its keys).</summary>
    /// <param name="request">The browser's push subscription and a name for the device.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>The device.</returns>
    /// <response code="200">Saved.</response>
    /// <response code="400">A field is invalid, or the account already has 20 devices.</response>
    [HttpPost("api/v1/account/push-subscriptions")]
    [ProducesResponseType<PushSubscriptionResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ValidationProblemDetails>(StatusCodes.Status400BadRequest)]
    public Task<PushSubscriptionResponse> Subscribe(PushSubscriptionRequest request, CancellationToken cancellationToken) =>
        push.SubscribeAsync(User.GetUserId(), request, cancellationToken);

    /// <summary>Turns notifications off for a device.</summary>
    /// <param name="id">The device.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>No content.</returns>
    /// <response code="204">Removed.</response>
    /// <response code="404">No such device.</response>
    [HttpDelete("api/v1/account/push-subscriptions/{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Unsubscribe(Guid id, CancellationToken cancellationToken) =>
        await push.UnsubscribeAsync(User.GetUserId(), id, cancellationToken) ? NoContent() : NotFound();

    /// <summary>Sends a test notification to one device.</summary>
    /// <param name="id">The device.</param>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>No content.</returns>
    /// <response code="204">The push service accepted it.</response>
    /// <response code="404">No such device.</response>
    /// <response code="410">The device's subscription has expired and was removed; turn notifications on again.</response>
    /// <response code="502">The push service refused it or could not be reached.</response>
    [HttpPost("api/v1/account/push-subscriptions/{id:guid}/test")]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status410Gone)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status502BadGateway)]
    public async Task<IActionResult> Test(Guid id, CancellationToken cancellationToken) =>
        await push.SendToDeviceAsync(User.GetUserId(), id, new PushMessage("Notifications are on", "Reminders will appear like this.", Tag: "test"), cancellationToken) switch
        {
            null => NotFound(),
            PushOutcome.Sent => NoContent(),
            PushOutcome.Gone => Problem(statusCode: StatusCodes.Status410Gone, title: "This device's subscription has expired. Turn notifications on again."),
            _ => Problem(statusCode: StatusCodes.Status502BadGateway, title: "The push service did not accept the notification. Try again later."),
        };
}

/// <summary>The server's public VAPID key.</summary>
/// <param name="PublicKey">The key, base64url (the browser's <c>applicationServerKey</c>).</param>
public sealed record PushKeyResponse(string PublicKey);
