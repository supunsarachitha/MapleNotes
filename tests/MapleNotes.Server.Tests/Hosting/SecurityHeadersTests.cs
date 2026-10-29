using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Hosting;

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
        Assert.Contains("script-src 'self' 'wasm-unsafe-eval';", csp, StringComparison.Ordinal); // WebAssembly, not eval
        Assert.Contains("worker-src 'self'", csp, StringComparison.Ordinal);
        Assert.Contains("frame-ancestors 'none'", csp, StringComparison.Ordinal);
        Assert.DoesNotContain("'unsafe-eval'", csp, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Api_responses_are_not_stored_by_browsers()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/v1/auth/status", TestContext.Current.CancellationToken);

        Assert.True(response.Headers.CacheControl?.NoStore);
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

    [Theory]
    [InlineData("/scalar")]
    [InlineData("/scalar/v1")]
    [InlineData("/openapi/v1.json")]
    [InlineData("/openapi/anything")]
    public async Task Api_reference_paths_keep_the_app_policy_when_the_reference_is_off(string path)
    {
        // Outside Development, with MAPLE_API_DOCS unset, these are unknown routes; the web app served there must keep
        // the application policy, and no exemption may apply to a reference page that is not there.
        await using var app = new MapleAppFactory();
        using var client = app.WithWebHostBuilder(builder => builder.UseEnvironment("Production")).CreateClient();

        var response = await client.GetAsync(path, TestContext.Current.CancellationToken);

        var csp = Header(response, "Content-Security-Policy");
        Assert.Contains("script-src 'self' 'wasm-unsafe-eval';", csp, StringComparison.Ordinal);
        Assert.DoesNotContain("'unsafe-inline'; style-src", csp, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Api_reference_page_has_its_own_policy_when_switched_on()
    {
        await using var app = new MapleAppFactory();
        app.Settings[MapleOptions.ApiDocsKey] = "true";
        using var client = app.WithWebHostBuilder(builder => builder.UseEnvironment("Production")).CreateClient();

        var response = await client.GetAsync("/scalar", TestContext.Current.CancellationToken);

        response.EnsureSuccessStatusCode();
        var csp = Header(response, "Content-Security-Policy");
        Assert.Contains("script-src 'self' 'unsafe-inline';", csp, StringComparison.Ordinal);
        Assert.Contains("connect-src 'self'", csp, StringComparison.Ordinal);
        Assert.Contains("frame-ancestors 'none'", csp, StringComparison.Ordinal);
        Assert.Contains("object-src 'none'", csp, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Openapi_document_carries_the_app_policy()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/openapi/v1.json", TestContext.Current.CancellationToken);

        response.EnsureSuccessStatusCode();
        Assert.Contains("script-src 'self' 'wasm-unsafe-eval';", Header(response, "Content-Security-Policy"), StringComparison.Ordinal);
    }

    private static string Header(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values) ? string.Join(",", values) : string.Empty;
}
