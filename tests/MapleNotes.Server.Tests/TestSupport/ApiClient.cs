using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using MapleNotes.Server.Features.Auth;

namespace MapleNotes.Server.Tests.TestSupport;

/// <summary>
/// A browser-like API client: keeps cookies, sends the antiforgery header (refreshing the token after sign-in and
/// sign-out), and signs in with keys derived from the password exactly as the web app does, so the password itself
/// is never sent.
/// </summary>
public sealed class ApiClient : IDisposable
{
    public const string DefaultPassword = "correct horse battery staple";

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    // Argon2id is slow by design; each (password, parameters) pair is derived once per test run.
    private static readonly ConcurrentDictionary<string, Lazy<(byte[] AuthKey, byte[] WrapKey)>> DerivedKeys = new();

    public ApiClient(MapleAppFactory factory)
    {
        Http = factory.CreateClient();
    }

    public HttpClient Http { get; }

    /// <summary>The account this client last registered or signed in to.</summary>
    public string? Username { get; private set; }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    /// <summary>
    /// Parameters for test accounts: the spec's minimum cost, and a salt derived from the password (the web app
    /// uses a random one) so that all accounts sharing a password share one derivation.
    /// </summary>
    public static KdfParameters TestKdf(string password = DefaultPassword) =>
        new(SHA256.HashData(Encoding.UTF8.GetBytes($"maple-notes-test/{password}"))[..KeyDerivation.SaltBytes],
            E2eeCrypto.TestMemoryKiB, E2eeCrypto.TestIterations, 1);

    /// <summary>The keys the web app derives from <paramref name="password"/> with <paramref name="kdf"/>.</summary>
    public static (byte[] AuthKey, byte[] WrapKey) DeriveKeys(string password, KdfParameters kdf) =>
        DerivedKeys.GetOrAdd(
            $"{password}\n{Convert.ToBase64String(kdf.Salt)}\n{kdf.MemoryKiB}\n{kdf.Iterations}\n{kdf.Parallelism}",
            _ => new Lazy<(byte[], byte[])>(() =>
                E2eeCrypto.AccountKeys(password, kdf.Salt, kdf.MemoryKiB, kdf.Iterations, kdf.Parallelism))).Value;

    public async Task RefreshAntiforgeryTokenAsync()
    {
        var token = await Http.GetFromJsonAsync<AntiforgeryTokenResponse>("/api/v1/auth/antiforgery", Json, Ct);
        Http.DefaultRequestHeaders.Remove(token!.HeaderName);
        Http.DefaultRequestHeaders.Add(token.HeaderName, token.Token);
    }

    public async Task<PreloginResponse> PreloginAsync(string username)
    {
        var response = await Http.PostAsJsonAsync("/api/v1/auth/prelogin", new PreloginRequest(username), Json, Ct);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<PreloginResponse>(Json, Ct))!;
    }

    public async Task<HttpResponseMessage> RegisterAsync(
        string username, string password = DefaultPassword, string? displayName = null, KdfParameters? kdf = null)
    {
        await RefreshAntiforgeryTokenAsync();
        kdf ??= TestKdf(password);
        var request = new RegisterRequest(username, kdf, DeriveKeys(password, kdf).AuthKey, displayName);
        var response = await Http.PostAsJsonAsync("/api/v1/auth/register", request, Json, Ct);
        await AfterSignInAttemptAsync(response, username);
        return response;
    }

    /// <summary>Signs in like the web app: prelogin, derive the keys, send the authentication key.</summary>
    public async Task<HttpResponseMessage> LoginAsync(string username, string password = DefaultPassword, bool rememberMe = false)
    {
        await RefreshAntiforgeryTokenAsync();
        var prelogin = await PreloginAsync(username);
        var request = new LoginRequest(
            username, DeriveKeys(password, prelogin.Kdf).AuthKey, rememberMe, Password: prelogin.Upgrade ? password : null);
        var response = await Http.PostAsJsonAsync("/api/v1/auth/login", request, Json, Ct);
        await AfterSignInAttemptAsync(response, username);
        return response;
    }

    /// <summary>Registers and fails the test on error.</summary>
    public async Task<UserResponse> SignUpAsync(string username, string password = DefaultPassword)
    {
        var response = await RegisterAsync(username, password);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<UserResponse>(Json, Ct))!;
    }

    /// <summary>Proof of <paramref name="password"/> for the signed-in account, built as the web app builds it.</summary>
    public async Task<CredentialProof> ProofAsync(string password = DefaultPassword)
    {
        var prelogin = await PreloginAsync(Username ?? throw new InvalidOperationException("Sign in first."));
        return new CredentialProof(DeriveKeys(password, prelogin.Kdf).AuthKey, prelogin.Upgrade ? password : null);
    }

    /// <summary>Changes the password like the web app: proof of the current one, new parameters and key.</summary>
    public async Task<HttpResponseMessage> ChangePasswordAsync(string current, string next)
    {
        var newKdf = TestKdf(next);
        var request = new ChangePasswordRequest(await ProofAsync(current), newKdf, DeriveKeys(next, newKdf).AuthKey);
        return await PutJsonAsync("/api/v1/auth/password", request);
    }

    public async Task<HttpResponseMessage> UploadAsync(byte[] content, string fileName, string contentType = "application/octet-stream")
    {
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(contentType);
        form.Add(file, "file", fileName);
        return await Http.PostAsync("/api/v1/attachments", form, Ct);
    }

    /// <summary>Uploads a file encrypted in the browser: the ID and metadata fields come before the file part.</summary>
    public async Task<HttpResponseMessage> UploadEncryptedAsync(Guid? id, byte[]? metadata, byte[] ciphertext)
    {
        using var form = new MultipartFormDataContent();
        if (id is not null)
        {
            form.Add(new StringContent(id.Value.ToString()), "id");
        }

        if (metadata is not null)
        {
            form.Add(new StringContent(Convert.ToBase64String(metadata)), "metadata");
        }

        var file = new ByteArrayContent(ciphertext);
        file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
        form.Add(file, "file", "encrypted.bin");
        return await Http.PostAsync("/api/v1/attachments", form, Ct);
    }

    /// <summary>Sends one file with optional form fields (fields first) as multipart/form-data with PUT.</summary>
    public async Task<HttpResponseMessage> PutFileAsync(string url, byte[] content, string fileName, string contentType, IReadOnlyDictionary<string, string>? fields = null)
    {
        using var form = new MultipartFormDataContent();
        foreach (var (name, value) in fields ?? new Dictionary<string, string>())
        {
            form.Add(new StringContent(value), name);
        }

        var file = new ByteArrayContent(content);
        file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(contentType);
        form.Add(file, "file", fileName);
        return await Http.PutAsync(url, form, Ct);
    }

    public Task<HttpResponseMessage> GetAsync(string url) => Http.GetAsync(url, Ct);

    public Task<T?> GetJsonAsync<T>(string url) => Http.GetFromJsonAsync<T>(url, Json, Ct);

    public Task<HttpResponseMessage> PostJsonAsync<T>(string url, T body) => Http.PostAsJsonAsync(url, body, Json, Ct);

    public Task<HttpResponseMessage> PutJsonAsync<T>(string url, T body) => Http.PutAsJsonAsync(url, body, Json, Ct);

    public Task<HttpResponseMessage> PatchJsonAsync<T>(string url, T body) => Http.PatchAsJsonAsync(url, body, Json, Ct);

    public Task<HttpResponseMessage> PostAsync(string url) => Http.PostAsync(url, content: null, Ct);

    public Task<HttpResponseMessage> DeleteAsync(string url) => Http.DeleteAsync(url, Ct);

    public void Dispose() => Http.Dispose();

    private async Task AfterSignInAttemptAsync(HttpResponseMessage response, string username)
    {
        if (response.IsSuccessStatusCode)
        {
            Username = username;
        }

        await RefreshAntiforgeryTokenAsync();
    }
}
