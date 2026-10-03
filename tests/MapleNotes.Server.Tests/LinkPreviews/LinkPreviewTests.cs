using System.Net;
using System.Text;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.LinkPreviews;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.Extensions.DependencyInjection;

namespace MapleNotes.Server.Tests.LinkPreviews;

/// <summary>
/// Link previews: only public http(s) pages are fetched (never the server's own network), HTML is read safely, results
/// are cached, and nothing happens unless both the server and the account allow it.
/// </summary>
public sealed class LinkPreviewTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Theory]
    [InlineData("93.184.215.14", true)]
    [InlineData("2606:4700::1111", true)]
    [InlineData("127.0.0.1", false)]
    [InlineData("10.1.2.3", false)]
    [InlineData("172.20.0.5", false)]
    [InlineData("192.168.1.1", false)]
    [InlineData("169.254.169.254", false)] // cloud metadata
    [InlineData("100.64.0.1", false)]
    [InlineData("0.0.0.0", false)]
    [InlineData("224.0.0.1", false)]
    [InlineData("::1", false)]
    [InlineData("::", false)]
    [InlineData("fe80::1", false)]
    [InlineData("fd00::1", false)]
    [InlineData("::ffff:127.0.0.1", false)]
    [InlineData("::ffff:10.0.0.1", false)]
    [InlineData("64:ff9b::a00:1", false)] // NAT64 of 10.0.0.1
    [InlineData("2002:c0a8:101::1", false)] // 6to4 of 192.168.1.1
    public void Only_public_addresses_may_be_contacted(string address, bool isPublic) =>
        Assert.Equal(isPublic, NetworkGuard.IsPublic(IPAddress.Parse(address)));

    [Fact]
    public async Task Names_that_resolve_to_the_server_itself_are_refused()
    {
        await Assert.ThrowsAsync<BlockedAddressException>(() => NetworkGuard.ResolvePublicAsync("localhost", Ct));
        await Assert.ThrowsAsync<BlockedAddressException>(() => NetworkGuard.ResolvePublicAsync("[::1]", Ct));
    }

    [Theory]
    [InlineData("https://example.com/page", null)]
    [InlineData("http://example.com", null)]
    [InlineData("ftp://example.com/file", "Only http and https links have previews.")]
    [InlineData("file:///etc/passwd", "Only http and https links have previews.")]
    [InlineData("https://example.com:8443/", "Only links on the standard ports, without a user name, have previews.")]
    [InlineData("https://admin:secret@example.com/", "Only links on the standard ports, without a user name, have previews.")]
    [InlineData("http://127.0.0.1/", "Links to private or local addresses have no previews.")]
    [InlineData("http://[::1]/", "Links to private or local addresses have no previews.")]
    [InlineData("http://localhost/", "Links to private or local addresses have no previews.")]
    [InlineData("http://printer.local/", "Links to private or local addresses have no previews.")]
    [InlineData("http://metadata.google.internal/", "Links to private or local addresses have no previews.")]
    [InlineData("http://intranet/", "Links to private or local addresses have no previews.")]
    [InlineData("not a link", "This is not a web address.")]
    public void Links_are_checked_before_anything_is_fetched(string url, string? error) =>
        Assert.Equal(error, LinkPreviewService.Validate(url));

    [Fact]
    public void Pages_are_read_from_open_graph_tags_then_the_basics()
    {
        var page = """
            <html><head>
            <title>Fallback</title>
            <meta property="og:title" content="Maple syrup &amp; pancakes">
            <meta name='description' content='  A   guide to
              breakfast  '>
            <meta property="og:site_name" content="Kitchen Notes">
            </head><body>…</body></html>
            """;

        var preview = LinkPreviewParser.Parse(page, new Uri("https://kitchen.example/syrup"));

        Assert.Equal(new LinkPreviewResponse("https://kitchen.example/syrup", "Maple syrup & pancakes", "A guide to breakfast", "Kitchen Notes"), preview);
        Assert.Equal(("Only a title", null, "plain.example"), Summary(LinkPreviewParser.Parse("<title>\n Only a title </title>", new Uri("https://plain.example/"))));
        Assert.Null(LinkPreviewParser.Parse("<p>no title here</p>", new Uri("https://x.example/")));
        Assert.EndsWith("…", LinkPreviewParser.Parse($"<title>{new string('a', 400)}</title>", new Uri("https://x.example/"))!.Title);
    }

    [Theory]
    [InlineData("<meta ", "a")] // one huge attribute-less tag: the attribute pattern used to backtrack quadratically
    [InlineData("<meta ", "<meta ")]
    [InlineData("", "<title>")]
    public void Hostile_pages_are_parsed_quickly(string prefix, string repeated)
    {
        var page = prefix + string.Concat(Enumerable.Repeat(repeated, (LinkPreviewService.MaxBytes - 1) / repeated.Length)) + ">";
        var watch = System.Diagnostics.Stopwatch.StartNew();

        LinkPreviewParser.Parse(page, new Uri("https://evil.example/"));

        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(2), $"Parsing took {watch.Elapsed}.");
    }

    private static (string, string?, string) Summary(LinkPreviewResponse? preview) => (preview!.Title, preview.Description, preview.SiteName);

    [Fact]
    public async Task Previews_need_the_accounts_consent_and_are_fetched_once()
    {
        var pages = new FakePages
        {
            ["https://news.example/story"] = FakePages.Html("<title>A story</title><meta name=description content=Short>"),
            ["https://news.example/image.png"] = new(HttpStatusCode.OK, "image/png", "png"),
        };
        await using var app = App(pages);
        using var client = new ApiClient(app);
        await client.SignUpAsync("reader");

        var refused = await client.GetAsync("/api/v1/link-preview?url=https://news.example/story");
        await TurnOnAsync(client);
        var first = await client.GetJsonAsync<LinkPreviewResponse>("/api/v1/link-preview?url=https://news.example/story");
        var second = await client.GetJsonAsync<LinkPreviewResponse>("/api/v1/link-preview?url=https://news.example/story");
        var image = await client.GetAsync("/api/v1/link-preview?url=https://news.example/image.png");

        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal(new LinkPreviewResponse("https://news.example/story", "A story", "Short", "news.example"), first);
        Assert.Equal(first, second);
        Assert.Equal(1, pages.Requests.Count(r => r == "https://news.example/story")); // cached
        Assert.Equal(HttpStatusCode.NoContent, image.StatusCode);
    }

    [Fact]
    public async Task Previews_are_cached_per_account_without_the_fragment_and_limited_per_account()
    {
        var pages = new FakePages { ["https://news.example/story"] = FakePages.Html("<title>A story</title>") };
        await using var app = App(pages);
        app.Settings[MapleOptions.AllowRegistrationKey] = "true";
        using var reader = new ApiClient(app);
        using var other = new ApiClient(app); // the same address as the reader
        await reader.SignUpAsync("reader");
        await other.SignUpAsync("other");
        await TurnOnAsync(reader);
        await TurnOnAsync(other);

        for (var i = 0; i < 60; i++)
        {
            (await reader.GetAsync($"/api/v1/link-preview?url=https://news.example/story%23part-{i}")).EnsureSuccessStatusCode();
        }

        var limited = await reader.GetAsync("/api/v1/link-preview?url=https://news.example/story");
        var others = await other.GetAsync("/api/v1/link-preview?url=https://news.example/story");

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode); // 60 a minute for each account
        Assert.Equal(HttpStatusCode.OK, others.StatusCode); // its own budget, although it shares the reader's address
        Assert.Equal(2, pages.Requests.Count(r => r == "https://news.example/story")); // once for each account
    }

    [Fact]
    public async Task Redirects_are_checked_like_the_first_address()
    {
        var pages = new FakePages
        {
            ["https://short.example/a"] = FakePages.Redirect("https://news.example/story"),
            ["https://news.example/story"] = FakePages.Html("<title>Arrived</title>"),
            ["https://short.example/b"] = FakePages.Redirect("http://169.254.169.254/latest/meta-data/"),
            ["https://short.example/loop"] = FakePages.Redirect("https://short.example/loop"),
        };
        await using var app = App(pages);
        using var client = new ApiClient(app);
        await client.SignUpAsync("reader");
        await TurnOnAsync(client);

        var followed = await client.GetJsonAsync<LinkPreviewResponse>("/api/v1/link-preview?url=https://short.example/a");
        var toMetadata = await client.GetAsync("/api/v1/link-preview?url=https://short.example/b");
        var loop = await client.GetAsync("/api/v1/link-preview?url=https://short.example/loop");
        var direct = await client.GetAsync("/api/v1/link-preview?url=http://169.254.169.254/latest/meta-data/");

        Assert.Equal("Arrived", followed!.Title);
        Assert.Equal(HttpStatusCode.NoContent, toMetadata.StatusCode);
        Assert.DoesNotContain(pages.Requests, r => r.Contains("169.254", StringComparison.Ordinal)); // never fetched
        Assert.Equal(HttpStatusCode.NoContent, loop.StatusCode);
        Assert.Equal(4, pages.Requests.Count(r => r == "https://short.example/loop")); // at most three redirects
        Assert.Equal(HttpStatusCode.BadRequest, direct.StatusCode);
    }

    [Fact]
    public async Task A_server_can_turn_previews_off_entirely()
    {
        var pages = new FakePages();
        await using var app = App(pages, allow: false);
        using var client = new ApiClient(app);
        await client.SignUpAsync("reader");
        await TurnOnAsync(client);

        var response = await client.GetAsync("/api/v1/link-preview?url=https://news.example/story");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.False((await client.GetJsonAsync<AuthStatusResponse>("/api/v1/auth/status"))!.LinkPreviewsAvailable);
        Assert.Empty(pages.Requests);
    }

    private static MapleAppFactory App(FakePages pages, bool allow = true)
    {
        var app = new MapleAppFactory
        {
            ConfigureTestServices = services =>
                services.AddHttpClient(LinkPreviewService.ClientName).ConfigurePrimaryHttpMessageHandler(() => pages),
        };
        app.Settings[MapleOptions.LinkPreviewsKey] = allow ? "true" : "false";
        return app;
    }

    private static async Task TurnOnAsync(ApiClient client) =>
        (await client.PutJsonAsync("/api/v1/account/preferences", new UserPreferences { LinkPreviews = true })).EnsureSuccessStatusCode();

    /// <summary>A pretend internet: canned responses by URL, recording every request made.</summary>
    private sealed class FakePages : HttpMessageHandler
    {
        private readonly Dictionary<string, Page> _pages = [];

        public List<string> Requests { get; } = [];

        public Page this[string url]
        {
            set => _pages[url] = value;
        }

        public static Page Html(string html) => new(HttpStatusCode.OK, "text/html", html);

        public static Page Redirect(string location) => new(HttpStatusCode.Found, "text/html", "", location);

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var url = request.RequestUri!.AbsoluteUri;
            lock (Requests)
            {
                Requests.Add(url);
            }

            if (!_pages.TryGetValue(url, out var page))
            {
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
            }

            var response = new HttpResponseMessage(page.Status) { Content = new StringContent(page.Body, Encoding.UTF8, page.ContentType) };
            if (page.Location is not null)
            {
                response.Headers.Location = new Uri(page.Location);
            }

            return Task.FromResult(response);
        }

        // The factory disposes handlers it created; this one lives as long as the test.
        protected override void Dispose(bool disposing)
        {
        }
    }

    private sealed record Page(HttpStatusCode Status, string ContentType, string Body, string? Location = null);
}
