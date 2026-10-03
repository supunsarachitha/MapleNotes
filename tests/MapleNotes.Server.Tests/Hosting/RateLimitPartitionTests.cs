using System.Net;
using MapleNotes.Server.Infrastructure.Web;

namespace MapleNotes.Server.Tests.Hosting;

/// <summary>Rate limits count IPv4 clients by address and IPv6 clients by their /64 network.</summary>
public sealed class RateLimitPartitionTests
{
    [Theory]
    [InlineData("203.0.113.7", "203.0.113.7")]
    [InlineData("::ffff:203.0.113.7", "203.0.113.7")]
    [InlineData("2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64")]
    [InlineData("2001:db8:1:2::1", "2001:db8:1:2::/64")]
    [InlineData("2001:db8:1:3::1", "2001:db8:1:3::/64")]
    [InlineData(null, "unknown")]
    public void Clients_are_counted_by_address_or_ipv6_network(string? address, string partition) =>
        Assert.Equal(partition, RateLimitPolicies.ClientPartition(address is null ? null : IPAddress.Parse(address)));
}
