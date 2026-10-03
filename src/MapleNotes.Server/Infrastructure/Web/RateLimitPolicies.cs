using System.Net;
using System.Net.Sockets;

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
