using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using MapleNotes.Server.Features.Auth;

namespace MapleNotes.Server.Tests.TestSupport;

/// <summary>
/// A browser-like API client: keeps cookies and sends the antiforgery header, refreshing the token after sign-in
/// and sign-out exactly as the web app does.
/// </summary>
public sealed class ApiClient : IDisposable
{
    public const string DefaultPassword = "correct horse battery staple";

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    public ApiClient(MapleAppFactory factory)
    {
        Http = factory.CreateClient();
    }

    public HttpClient Http { get; }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async Task RefreshAntiforgeryTokenAsync()
    {
        var token = await Http.GetFromJsonAsync<AntiforgeryTokenResponse>("/api/v1/auth/antiforgery", Json, Ct);
        Http.DefaultRequestHeaders.Remove(token!.HeaderName);
        Http.DefaultRequestHeaders.Add(token.HeaderName, token.Token);
    }

    public async Task<HttpResponseMessage> RegisterAsync(string username, string password = DefaultPassword, string? displayName = null)
    {
        await RefreshAntiforgeryTokenAsync();
        var response = await Http.PostAsJsonAsync("/api/v1/auth/register", new RegisterRequest(username, password, displayName), Json, Ct);
        await RefreshAntiforgeryTokenAsync();
        return response;
    }

    public async Task<HttpResponseMessage> LoginAsync(string username, string password = DefaultPassword, bool rememberMe = false)
    {
        await RefreshAntiforgeryTokenAsync();
        var response = await Http.PostAsJsonAsync("/api/v1/auth/login", new LoginRequest(username, password, rememberMe), Json, Ct);
        await RefreshAntiforgeryTokenAsync();
        return response;
    }

    /// <summary>Registers (or signs in, if the account exists) and fails the test on error.</summary>
    public async Task<UserResponse> SignUpAsync(string username, string password = DefaultPassword)
    {
        var response = await RegisterAsync(username, password);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<UserResponse>(Json, Ct))!;
    }

    public async Task<HttpResponseMessage> UploadAsync(byte[] content, string fileName, string contentType = "application/octet-stream")
    {
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(contentType);
        form.Add(file, "file", fileName);
        return await Http.PostAsync("/api/v1/attachments", form, Ct);
    }

    public Task<HttpResponseMessage> GetAsync(string url) => Http.GetAsync(url, Ct);

    public Task<T?> GetJsonAsync<T>(string url) => Http.GetFromJsonAsync<T>(url, Json, Ct);

    public Task<HttpResponseMessage> PostJsonAsync<T>(string url, T body) => Http.PostAsJsonAsync(url, body, Json, Ct);

    public Task<HttpResponseMessage> PutJsonAsync<T>(string url, T body) => Http.PutAsJsonAsync(url, body, Json, Ct);

    public Task<HttpResponseMessage> PatchJsonAsync<T>(string url, T body) => Http.PatchAsJsonAsync(url, body, Json, Ct);

    public Task<HttpResponseMessage> PostAsync(string url) => Http.PostAsync(url, content: null, Ct);

    public Task<HttpResponseMessage> DeleteAsync(string url) => Http.DeleteAsync(url, Ct);

    public void Dispose() => Http.Dispose();
}
