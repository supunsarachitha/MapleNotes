using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Push;

/// <summary>A device's subscription, as the browser sends it (<c>PushSubscription.toJSON()</c>, plus a name).</summary>
/// <param name="Endpoint">The push service URL.</param>
/// <param name="P256dh">The browser's public key, base64url.</param>
/// <param name="Auth">The browser's authentication secret, base64url.</param>
/// <param name="Name">A name for the device, such as "Chrome on Android".</param>
public sealed record PushSubscriptionRequest(string? Endpoint, string? P256dh, string? Auth, string? Name);

/// <summary>A device that receives notifications.</summary>
/// <param name="Id">Its ID.</param>
/// <param name="Name">Its name.</param>
/// <param name="Endpoint">Its push endpoint, so a browser can tell which one is itself.</param>
/// <param name="CreatedAtUtc">When it was added.</param>
/// <param name="LastSentAtUtc">When a notification last reached its push service.</param>
public sealed record PushSubscriptionResponse(Guid Id, string Name, string Endpoint, DateTime CreatedAtUtc, DateTime? LastSentAtUtc);

/// <summary>A notification, as the service worker receives it (JSON, encrypted for the device).</summary>
/// <param name="Title">The title.</param>
/// <param name="Body">The text.</param>
/// <param name="NoteId">The note to open when it is tapped, if any.</param>
/// <param name="Tag">Replaces an earlier notification with the same tag instead of stacking.</param>
public sealed record PushMessage(string Title, string Body, Guid? NoteId = null, string? Tag = null);

/// <summary>What happened to one message.</summary>
public enum PushOutcome
{
    /// <summary>The push service accepted it.</summary>
    Sent,

    /// <summary>The subscription has expired or was removed by the browser; it has been deleted.</summary>
    Gone,

    /// <summary>The push service refused it or could not be reached; it may work later.</summary>
    Failed,
}

/// <summary>Keeps devices' push subscriptions and sends them notifications (Web Push, RFC 8030/8291/8292).</summary>
public sealed class PushService(
    MapleDbContext db, InstanceSettingsService settings, IHttpClientFactory http, MapleOptions options, TimeProvider time,
    ILogger<PushService> logger)
{
    /// <summary>The named HTTP client; like link previews, it connects only to public addresses.</summary>
    public const string ClientName = "push";

    /// <summary>How long a push service keeps trying to deliver a message to an offline device.</summary>
    private static readonly TimeSpan MessageLifetime = TimeSpan.FromHours(6);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>The public VAPID key browsers subscribe with (the <c>applicationServerKey</c>), base64url.</summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The key.</returns>
    public async Task<string> GetPublicKeyAsync(CancellationToken cancellationToken) =>
        WebEncoders.Base64UrlEncode((await settings.GetVapidKeysAsync(cancellationToken)).PublicKey);

    /// <summary>Lists the account's devices, newest first.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The devices.</returns>
    public async Task<IReadOnlyList<PushSubscriptionResponse>> ListAsync(Guid userId, CancellationToken cancellationToken) =>
        await db.PushSubscriptions.AsNoTracking().Where(s => s.UserId == userId).OrderByDescending(s => s.CreatedAtUtc)
            .Select(s => new PushSubscriptionResponse(s.Id, s.Name, s.Endpoint, s.CreatedAtUtc, s.LastSentAtUtc))
            .ToListAsync(cancellationToken);

    /// <summary>
    /// Adds a device, or updates it when its endpoint is already known (a browser renewing its keys). An endpoint
    /// another account registered moves to this one: the browser is now signed in here.
    /// </summary>
    /// <param name="userId">The account.</param>
    /// <param name="request">The subscription.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The device.</returns>
    /// <exception cref="ApiValidationException">A field is missing or invalid, or the account has too many devices.</exception>
    public async Task<PushSubscriptionResponse> SubscribeAsync(Guid userId, PushSubscriptionRequest request, CancellationToken cancellationToken)
    {
        var endpoint = request.Endpoint?.Trim() ?? "";
        if (endpoint.Length is 0 or > PushSubscription.MaxEndpointLength || !IsAllowedEndpoint(endpoint))
        {
            throw new ApiValidationException("endpoint", "Give the https address of a push service.");
        }

        var p256dh = Decode(request.P256dh);
        if (p256dh is null || !WebPushCrypto.IsValidPublicKey(p256dh))
        {
            throw new ApiValidationException("p256dh", "Give the browser's P-256 public key (base64url, uncompressed).");
        }

        var auth = Decode(request.Auth);
        if (auth is not { Length: 16 })
        {
            throw new ApiValidationException("auth", "Give the browser's 16-byte authentication secret (base64url).");
        }

        var name = string.Concat((request.Name ?? "").Trim().Where(c => !char.IsControl(c)));
        name = name.Length == 0 ? "This device" : name[..Math.Min(name.Length, PushSubscription.MaxNameLength)];

        var existing = await db.PushSubscriptions.SingleOrDefaultAsync(s => s.Endpoint == endpoint, cancellationToken);
        if (existing is not null && existing.UserId != userId)
        {
            db.PushSubscriptions.Remove(existing);
            existing = null;
        }

        if (existing is null)
        {
            if (await db.PushSubscriptions.CountAsync(s => s.UserId == userId, cancellationToken) >= PushSubscription.MaxPerAccount)
            {
                throw new ApiValidationException("endpoint", $"An account can have notifications on at most {PushSubscription.MaxPerAccount} devices. Turn them off on one first.");
            }

            existing = new PushSubscription
            {
                UserId = userId, Endpoint = endpoint, P256dh = p256dh, Auth = auth, Name = name, CreatedAtUtc = time.GetUtcNow().UtcDateTime,
            };
            db.PushSubscriptions.Add(existing);
        }
        else
        {
            (existing.P256dh, existing.Auth, existing.Name) = (p256dh, auth, name);
        }

        await db.SaveChangesAsync(cancellationToken);
        return new(existing.Id, existing.Name, existing.Endpoint, existing.CreatedAtUtc, existing.LastSentAtUtc);
    }

    /// <summary>Removes one of the account's devices.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="id">The device.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>False when there is no such device.</returns>
    public async Task<bool> UnsubscribeAsync(Guid userId, Guid id, CancellationToken cancellationToken) =>
        await db.PushSubscriptions.Where(s => s.UserId == userId && s.Id == id).ExecuteDeleteAsync(cancellationToken) > 0;

    /// <summary>Sends a message to every device of the account.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="message">The message.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>How many devices it reached.</returns>
    public async Task<int> SendToAccountAsync(Guid userId, PushMessage message, CancellationToken cancellationToken)
    {
        var subscriptions = await db.PushSubscriptions.Where(s => s.UserId == userId).ToListAsync(cancellationToken);
        var sent = 0;
        foreach (var subscription in subscriptions)
        {
            sent += await SendAsync(subscription, message, cancellationToken) == PushOutcome.Sent ? 1 : 0;
        }

        return sent;
    }

    /// <summary>Sends a message to one of the account's devices.</summary>
    /// <param name="userId">The account.</param>
    /// <param name="id">The device.</param>
    /// <param name="message">The message.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>What happened, or null when there is no such device.</returns>
    public async Task<PushOutcome?> SendToDeviceAsync(Guid userId, Guid id, PushMessage message, CancellationToken cancellationToken) =>
        await db.PushSubscriptions.SingleOrDefaultAsync(s => s.UserId == userId && s.Id == id, cancellationToken) is { } subscription
            ? await SendAsync(subscription, message, cancellationToken)
            : null;

    /// <summary>Encrypts the message for the device and posts it to its push service.</summary>
    private async Task<PushOutcome> SendAsync(PushSubscription subscription, PushMessage message, CancellationToken cancellationToken)
    {
        var (publicKey, privateKey) = await settings.GetVapidKeysAsync(cancellationToken);
        var endpoint = new Uri(subscription.Endpoint);
        var body = WebPushCrypto.Encrypt(JsonSerializer.SerializeToUtf8Bytes(message, Json), subscription.P256dh, subscription.Auth);
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint) { Content = new ByteArrayContent(body) };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        request.Content.Headers.ContentEncoding.Add("aes128gcm");
        request.Headers.TryAddWithoutValidation("TTL", ((int)MessageLifetime.TotalSeconds).ToString(System.Globalization.CultureInfo.InvariantCulture));
        request.Headers.TryAddWithoutValidation("Urgency", "high");
        request.Headers.TryAddWithoutValidation(
            "Authorization", WebPushCrypto.VapidAuthorization(endpoint, publicKey, privateKey, options.PushContact, time.GetUtcNow().AddHours(12)));

        HttpStatusCode status;
        try
        {
            using var response = await http.CreateClient(ClientName).SendAsync(request, cancellationToken);
            status = response.StatusCode;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("A push service could not be reached ({Host}): {Message}", endpoint.Host, ex.Message);
            return PushOutcome.Failed;
        }

        if ((int)status is >= 200 and < 300)
        {
            subscription.LastSentAtUtc = time.GetUtcNow().UtcDateTime;
            await db.SaveChangesAsync(cancellationToken);
            return PushOutcome.Sent;
        }

        if (status is HttpStatusCode.NotFound or HttpStatusCode.Gone)
        {
            db.PushSubscriptions.Remove(subscription); // the browser unsubscribed or the subscription expired
            await db.SaveChangesAsync(cancellationToken);
            return PushOutcome.Gone;
        }

        logger.LogWarning("A push service ({Host}) refused a notification: {Status}", endpoint.Host, (int)status);
        return PushOutcome.Failed;
    }

    /// <summary>An https URL on a named host (not an address literal or localhost); the client checks the address too.</summary>
    private static bool IsAllowedEndpoint(string endpoint) =>
        Uri.TryCreate(endpoint, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttps
        && string.IsNullOrEmpty(uri.UserInfo)
        && uri.HostNameType == UriHostNameType.Dns
        && !uri.IsLoopback
        && uri.Host.Contains('.', StringComparison.Ordinal);

    private static byte[]? Decode(string? base64Url)
    {
        try
        {
            return string.IsNullOrWhiteSpace(base64Url) || base64Url.Length > 200 ? null : WebEncoders.Base64UrlDecode(base64Url.Trim());
        }
        catch (FormatException)
        {
            return null;
        }
    }
}
