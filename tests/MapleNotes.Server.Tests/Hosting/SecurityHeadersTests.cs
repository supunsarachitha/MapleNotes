using MapleNotes.Server.Tests.TestSupport;

namespace MapleNotes.Server.Tests.Hosting;

public sealed class SecurityHeadersTests(MapleAppFactory factory) : IClassFixture<MapleAppFactory>
{
    [Theory]
    [InlineData("/healthz")]
    [InlineData("/api/v1/auth/status")]
    [InlineData("/api/v1/notes")]
    public async Task Every_response_carries_the_security_headers(string path)
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync(path, TestContext.Current.CancellationToken);

        Assert.Equal("nosniff", Header(response, "X-Content-Type-Options"));
        Assert.Equal("DENY", Header(response, "X-Frame-Options"));
        Assert.Equal("no-referrer", Header(response, "Referrer-Policy"));
        var csp = Header(response, "Content-Security-Policy");
        Assert.Contains("script-src 'self'", csp, StringComparison.Ordinal);
        Assert.Contains("frame-ancestors 'none'", csp, StringComparison.Ordinal);
        Assert.DoesNotContain("unsafe-eval", csp, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Openapi_document_includes_the_xml_documentation()
    {
        using var client = factory.CreateClient();

        var document = await client.GetStringAsync("/openapi/v1.json", TestContext.Current.CancellationToken);

        Assert.Contains("/api/v1/notes", document, StringComparison.Ordinal);
        Assert.Contains("/api/v1/attachments/{id}", document, StringComparison.Ordinal);
        Assert.Contains("Lists notes, newest first", document, StringComparison.Ordinal);
    }

    private static string Header(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values) ? string.Join(",", values) : string.Empty;
}
