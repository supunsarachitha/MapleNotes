using System.Net;
using System.Net.Sockets;

namespace MapleNotes.Server.Features.LinkPreviews;

/// <summary>Thrown when a link points at an address the server must not contact.</summary>
/// <param name="message">Why.</param>
public sealed class BlockedAddressException(string message) : Exception(message);

/// <summary>
/// Keeps link previews from reaching into the server's own network (server-side request forgery): only addresses on
/// the public internet may be contacted. The check runs when the connection is made, on the address actually used, so
/// a name that resolves differently later (DNS rebinding) cannot slip through.
/// </summary>
public static class NetworkGuard
{
    /// <summary>Whether an address is on the public internet (not loopback, private, link-local, reserved…).</summary>
    /// <param name="address">The address.</param>
    /// <returns>True when it may be contacted.</returns>
    public static bool IsPublic(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }

        var b = address.GetAddressBytes();
        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            return !(b[0] == 0 // "this" network
                || b[0] == 10 // private
                || b[0] == 127 // loopback
                || (b[0] == 100 && b[1] is >= 64 and <= 127) // carrier-grade NAT
                || (b[0] == 169 && b[1] == 254) // link-local, including cloud metadata (169.254.169.254)
                || (b[0] == 172 && b[1] is >= 16 and <= 31) // private
                || (b[0] == 192 && b[1] == 0 && b[2] is 0 or 2) // IETF protocol assignments, documentation
                || (b[0] == 192 && b[1] == 168) // private
                || (b[0] == 198 && b[1] is 18 or 19) // benchmarking
                || (b[0] == 198 && b[1] == 51 && b[2] == 100) // documentation
                || (b[0] == 203 && b[1] == 0 && b[2] == 113) // documentation
                || b[0] >= 224); // multicast, reserved, broadcast
        }

        if (address.AddressFamily != AddressFamily.InterNetworkV6)
        {
            return false;
        }

        if (IPAddress.IsLoopback(address) || address.Equals(IPAddress.IPv6Any) || address.IsIPv6LinkLocal || address.IsIPv6SiteLocal
            || address.IsIPv6Multicast || address.IsIPv6UniqueLocal)
        {
            return false;
        }

        if (b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0d && b[3] == 0xb8)
        {
            return false; // documentation
        }

        // Addresses that carry an IPv4 address: judge that one (NAT64 64:ff9b::/96, 6to4 2002::/16).
        if (b[0] == 0x00 && b[1] == 0x64 && b[2] == 0xff && b[3] == 0x9b && b[4..12].All(x => x == 0))
        {
            return IsPublic(new IPAddress(b[12..16]));
        }

        if (b[0] == 0x20 && b[1] == 0x02)
        {
            return IsPublic(new IPAddress(b[2..6]));
        }

        return b[0] != 0; // ::/8 holds the unspecified, loopback and compatibility addresses
    }

    /// <summary>Resolves a host name to a public address to connect to.</summary>
    /// <param name="host">A host name or address literal.</param>
    /// <param name="cancellationToken">Cancels the lookup.</param>
    /// <returns>The first public address.</returns>
    /// <exception cref="BlockedAddressException">The name has no public address.</exception>
    public static async Task<IPAddress> ResolvePublicAsync(string host, CancellationToken cancellationToken)
    {
        var addresses = IPAddress.TryParse(host.Trim('[', ']'), out var literal)
            ? [literal]
            : await Dns.GetHostAddressesAsync(host, cancellationToken);
        return addresses.FirstOrDefault(IsPublic)
            ?? throw new BlockedAddressException($"'{host}' is not on the public internet.");
    }

    /// <summary>A connection to a public address only; used as the preview client's <c>ConnectCallback</c>.</summary>
    /// <param name="context">The connection being made.</param>
    /// <param name="cancellationToken">Cancels the connection.</param>
    /// <returns>The connected stream.</returns>
    public static async ValueTask<Stream> ConnectAsync(SocketsHttpConnectionContext context, CancellationToken cancellationToken)
    {
        var address = await ResolvePublicAsync(context.DnsEndPoint.Host, cancellationToken);
        var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(new IPEndPoint(address, context.DnsEndPoint.Port), cancellationToken);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }
}
