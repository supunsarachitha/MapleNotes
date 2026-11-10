using System.Net;
using System.Net.Sockets;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace MapleNotes.Server.Infrastructure.Web;

/// <summary>Names of the rate-limiting policies.</summary>
public static class RateLimitPolicies
{
    /// <summary>
    /// Limits sign-in, registration and password-confirmation attempts per client IP address per minute
    /// (<c>MAPLE_AUTH_RATE_LIMIT</c>, default 10), slowing down password guessing.
    /// </summary>
    public const string Authentication = "authentication";

    /// <summary>
    /// Limits prelogin requests per client IP address per minute, with the same limit as
    /// <see cref="Authentication"/> but a separate budget, since every sign-in makes one of each.
    /// </summary>
    public const string Prelogin = "prelogin";

    /// <summary>
    /// Requests to <see cref="Authentication"/> and <see cref="Prelogin"/> endpoints that may run at once across all
    /// clients: one per processor (at least four). Each such request runs PBKDF2 for 100 to 200 ms, so without a shared
    /// cap many addresses together (a botnet) could keep every core busy although each stays within its own budget.
    /// </summary>
    public static int GlobalConcurrencyLimit => Math.Max(4, Environment.ProcessorCount);

    /// <summary>
    /// Requests that may wait for a free slot under <see cref="GlobalConcurrencyLimit"/>; beyond that the server answers
    /// 429 at once instead of building a backlog.
    /// </summary>
    public const int GlobalQueueLimit = 100;

    /// <summary>
    /// The limiter that runs before the per-address policies: it caps how many requests to endpoints with the
    /// <see cref="Authentication"/> or <see cref="Prelogin"/> policy run at once, all clients together, and lets every
    /// other request through.
    /// </summary>
    /// <param name="permitLimit">Requests that may run at once.</param>
    /// <param name="queueLimit">Requests that may wait for a slot, oldest first.</param>
    /// <returns>The limiter.</returns>
    public static PartitionedRateLimiter<HttpContext> CreateGlobalLimiter(int permitLimit, int queueLimit) =>
        PartitionedRateLimiter.Create<HttpContext, string>(context =>
            context.GetEndpoint()?.Metadata.GetMetadata<EnableRateLimitingAttribute>()?.PolicyName is Authentication or Prelogin
                ? RateLimitPartition.GetConcurrencyLimiter("authentication", _ => new ConcurrencyLimiterOptions
                {
                    PermitLimit = permitLimit,
                    QueueLimit = queueLimit,
                    QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                })
                : RateLimitPartition.GetNoLimiter(string.Empty));

    /// <summary>Limits link previews per signed-in user per minute (60), bounding the requests the server makes for them.</summary>
    public const string LinkPreview = "link-preview";

    /// <summary>
    /// The rate-limit partition of a client address: the address itself for IPv4, and its /64 network for IPv6, which
    /// is what one client usually holds (a single home connection or server gets a whole /64), so cycling through the
    /// addresses of one network does not multiply the budget.
    /// </summary>
    /// <param name="address">The client's address, or null when unknown.</param>
    /// <returns>The partition key.</returns>
    public static string ClientPartition(IPAddress? address)
    {
        if (address is null)
        {
            return "unknown";
        }

        if (address.IsIPv4MappedToIPv6)
        {
            return address.MapToIPv4().ToString();
        }

        if (address.AddressFamily != AddressFamily.InterNetworkV6)
        {
            return address.ToString();
        }

        var bytes = address.GetAddressBytes();
        Array.Clear(bytes, 8, 8);
        return $"{new IPAddress(bytes)}/64";
    }
}
