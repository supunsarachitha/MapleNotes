using System.Net;
using MapleNotes.Server.Infrastructure.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace MapleNotes.Server.Tests.Hosting;

public sealed class HostingTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Healthz_reports_healthy()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/healthz", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Unknown_api_routes_return_404_instead_of_the_spa()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/v1/does-not-exist", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [InlineData(null, 8080)]
    [InlineData("", 8080)]
    [InlineData("5000", 5000)]
    [InlineData("8081;8082", 8081)]
    [InlineData(" 9000 , 9001", 9000)]
    [InlineData("not-a-port", 8080)]
    [InlineData("70000", 8080)]
    public void Health_probe_resolves_the_listening_port(string? httpPorts, int expected)
    {
        Assert.Equal(expected, HealthProbe.ResolvePort(httpPorts));
    }
}
