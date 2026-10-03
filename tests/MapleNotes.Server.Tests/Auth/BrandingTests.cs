using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Tests.TestSupport;
using Microsoft.AspNetCore.Mvc;

namespace MapleNotes.Server.Tests.Auth;

/// <summary>
/// The app's name and icon: set by administrators only, shown to everyone including visitors who have not signed in,
/// and the icon accepted only as a PNG, JPEG or WebP image, served sandboxed and cached by version.
/// </summary>
public sealed class BrandingTests : IAsyncLifetime
{
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];
    private static readonly byte[] OtherPng = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 9, 9, 9];

    private readonly MapleAppFactory _app = new() { Settings = { [MapleOptions.AllowRegistrationKey] = "true" } };
    private ApiClient _admin = null!;
    private ApiClient _member = null!;
    private ApiClient _visitor = null!;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _admin = new ApiClient(_app);
        _member = new ApiClient(_app);
        _visitor = new ApiClient(_app);
        await _admin.SignUpAsync("admin");
        await _member.SignUpAsync("member");
    }

    public async ValueTask DisposeAsync()
    {
        _admin.Dispose();
        _member.Dispose();
        _visitor.Dispose();
        await _app.DisposeAsync();
    }

    [Fact]
    public async Task The_app_is_Maple_Notes_with_its_own_icon_until_administrators_change_it()
    {
        Assert.Equal(new BrandingResponse("Maple Notes", null), await BrandingAsync(_visitor));
        Assert.Equal(HttpStatusCode.NotFound, (await _visitor.GetAsync("/api/v1/branding/icon")).StatusCode);
    }

    [Fact]
    public async Task The_version_is_shown_to_signed_in_users_only()
    {
        var member = (await _member.GetJsonAsync<AuthStatusResponse>("/api/v1/auth/status"))!.Version;

        Assert.Matches("^\\d+\\.\\d+\\.\\d+$", member);
        Assert.Null((await _visitor.GetJsonAsync<AuthStatusResponse>("/api/v1/auth/status"))!.Version);
    }

    [Fact]
    public async Task Administrators_rename_the_app_for_everyone_including_visitors()
    {
        (await _admin.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(true, null, "  Family Notes  "))).EnsureSuccessStatusCode();

        Assert.Equal("Family Notes", (await BrandingAsync(_visitor)).AppName);
        Assert.Equal("Family Notes", (await _admin.GetJsonAsync<InstanceSettingsResponse>("/api/v1/admin/settings"))!.AppName);

        (await _admin.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(true, null, " "))).EnsureSuccessStatusCode();
        Assert.Equal("Maple Notes", (await BrandingAsync(_visitor)).AppName); // blank goes back to the default
    }

    [Theory]
    [InlineData("A name that is far too long for any menu at all")]
    [InlineData("Two\nlines")]
    public async Task Names_that_do_not_fit_on_one_line_are_refused(string name)
    {
        var response = await _admin.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(true, null, name));

        Assert.Contains("appName", (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>(Ct))!.Errors.Keys);
        Assert.Equal("Maple Notes", (await BrandingAsync(_visitor)).AppName);
    }

    [Fact]
    public async Task A_custom_icon_is_served_to_everyone_sandboxed_and_cached_by_version()
    {
        Assert.Equal(HttpStatusCode.NoContent, (await PutIconAsync(_admin, Png, "image/png")).StatusCode);

        var url = (await BrandingAsync(_visitor)).IconUrl!;
        Assert.Matches("^/api/v1/branding/icon\\?v=[0-9a-f]{16}$", url);
        var icon = await _visitor.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, icon.StatusCode);
        Assert.Equal("image/png", icon.Content.Headers.ContentType!.MediaType);
        Assert.Equal(Png, await icon.Content.ReadAsByteArrayAsync(Ct));
        Assert.Contains("immutable", icon.Headers.CacheControl!.ToString());
        Assert.Contains("sandbox", string.Join(";", icon.Headers.GetValues("Content-Security-Policy")));
        Assert.True((await _visitor.GetAsync("/api/v1/branding/icon")).Headers.CacheControl!.NoCache); // no version: check again

        await PutIconAsync(_admin, OtherPng, "image/png");
        Assert.NotEqual(url, (await BrandingAsync(_visitor)).IconUrl); // a new picture, a new address

        Assert.Equal(HttpStatusCode.NoContent, (await _admin.DeleteAsync("/api/v1/admin/branding/icon")).StatusCode);
        Assert.Null((await BrandingAsync(_visitor)).IconUrl);
        Assert.Equal(HttpStatusCode.NotFound, (await _visitor.GetAsync("/api/v1/branding/icon")).StatusCode);
    }

    [Fact]
    public async Task Only_images_from_administrators_become_the_icon()
    {
        var svg = Encoding.UTF8.GetBytes("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>");

        var byMember = await PutIconAsync(_member, Png, "image/png");
        var svgAsPng = await PutIconAsync(_admin, svg, "image/png");
        var svgType = await PutIconAsync(_admin, svg, "image/svg+xml");
        var tooLarge = await PutIconAsync(_admin, [.. Png, .. new byte[InstanceSettingsService.MaxIconBytes]], "image/png");

        Assert.Equal(HttpStatusCode.Forbidden, byMember.StatusCode);
        Assert.Contains("icon", (await svgAsPng.Content.ReadFromJsonAsync<ValidationProblemDetails>(Ct))!.Errors.Keys);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, svgType.StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, tooLarge.StatusCode);
        Assert.Null((await BrandingAsync(_visitor)).IconUrl);
        Assert.Equal(HttpStatusCode.Forbidden, (await _member.DeleteAsync("/api/v1/admin/branding/icon")).StatusCode);
    }

    [Theory]
    [InlineData(new byte[] { 0xFF, 0xD8, 0xFF, 0xE0, 0, 1 }, "image/jpeg")]
    [InlineData(new byte[] { (byte)'R', (byte)'I', (byte)'F', (byte)'F', 0, 0, 0, 0, (byte)'W', (byte)'E', (byte)'B', (byte)'P', 1 }, "image/webp")]
    [InlineData(new byte[] { (byte)'G', (byte)'I', (byte)'F', (byte)'8' }, null)]
    [InlineData(new byte[] { (byte)'<', (byte)'h', (byte)'t', (byte)'m' }, null)]
    public void Icons_are_recognised_by_their_first_bytes(byte[] content, string? type) =>
        Assert.Equal(type, InstanceSettingsService.DetectIconType(content));

    // The start of real files (300 × 200 pixels) from a browser's encoders; the size is in the first bytes, or, for
    // JPEG, in the frame header after the other segments.
    [Theory]
    [InlineData("iVBORw0KGgoAAAANSUhEUgAAASwAAADICAYAAABS39xVAAAH40lEQQ==")] // png
    [InlineData("/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCADIASwDASI=")] // jpeg
    [InlineData("UklGRmYDAABXRUJQVlA4WAoAAAAgAAAAKwEAxwAASUNDUMgBAAAAAA==")] // webp-lossy
    [InlineData("UklGRoQBAABXRUJQVlA4IHgBAACQFwCdASosAcgAPm02mUkkIyKhIg==")] // webp-lossy-simple
    [InlineData("UklGRiACAABXRUJQVlA4WAoAAAAgAAAAKwEAxwAASUNDUMgBAAAAAA==")] // webp-lossless
    [InlineData("UklGRj4AAABXRUJQVlA4TDIAAAAvK8ExAA/wM+bPZM7M/EcL1LSNJA==")] // webp-lossless-simple
    public void Icon_sizes_are_read_from_the_image_header(string start) =>
        Assert.Equal((300, 200), InstanceSettingsService.ReadImageSize(Convert.FromBase64String(start)));

    [Fact]
    public async Task The_manifest_lets_browsers_install_the_app_with_its_own_icons()
    {
        var response = await _visitor.GetAsync("/manifest.webmanifest");

        Assert.Equal("application/manifest+json", response.Content.Headers.ContentType!.MediaType);
        var manifest = await Manifest(response);
        Assert.Equal(("Maple Notes", "/", "standalone"), (manifest.GetProperty("name").GetString(), manifest.GetProperty("start_url").GetString(), manifest.GetProperty("display").GetString()));
        Assert.Equal(
            ["/icons/icon-192.png any", "/icons/icon-512.png any", "/icons/maskable-512.png maskable"],
            manifest.GetProperty("icons").EnumerateArray().Select(i => $"{i.GetProperty("src").GetString()} {i.GetProperty("purpose").GetString()}"));
    }

    [Fact]
    public async Task The_manifest_follows_the_apps_name_and_a_large_enough_custom_icon()
    {
        (await _admin.PutJsonAsync("/api/v1/admin/settings", new UpdateInstanceSettingsRequest(true, null, "Family Notes"))).EnsureSuccessStatusCode();
        await PutIconAsync(_admin, PngOfSize(512, 512), "image/png");
        var large = await Manifest(await _visitor.GetAsync("/manifest.webmanifest"));
        await PutIconAsync(_admin, PngOfSize(64, 64), "image/png");
        var small = await Manifest(await _visitor.GetAsync("/manifest.webmanifest"));

        Assert.Equal("Family Notes", large.GetProperty("name").GetString());
        var icon = Assert.Single(large.GetProperty("icons").EnumerateArray());
        Assert.Equal("512x512", icon.GetProperty("sizes").GetString());
        Assert.StartsWith("/api/v1/branding/icon?v=", icon.GetProperty("src").GetString(), StringComparison.Ordinal);
        // Too small for an installed app: the app's own icons instead.
        Assert.Equal(3, small.GetProperty("icons").GetArrayLength());
    }

    private static async Task<System.Text.Json.JsonElement> Manifest(HttpResponseMessage response) =>
        System.Text.Json.JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct)).RootElement;

    /// <summary>The start of a PNG file of the given size: its signature and header chunk.</summary>
    private static byte[] PngOfSize(int width, int height) =>
        [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, .. "IHDR"u8,
            (byte)(width >> 24), (byte)(width >> 16), (byte)(width >> 8), (byte)width,
            (byte)(height >> 24), (byte)(height >> 16), (byte)(height >> 8), (byte)height, 8, 6, 0, 0, 0];

    private static async Task<BrandingResponse> BrandingAsync(ApiClient client) =>
        (await client.GetJsonAsync<AuthStatusResponse>("/api/v1/auth/status"))!.Branding!;

    private static Task<HttpResponseMessage> PutIconAsync(ApiClient client, byte[] content, string type)
    {
        var body = new ByteArrayContent(content);
        body.Headers.ContentType = new MediaTypeHeaderValue(type);
        return client.Http.PutAsync("/api/v1/admin/branding/icon", body, Ct);
    }
}
