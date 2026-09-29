using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.EndToEnd;
using MapleNotes.Server.Features.Notes;

namespace MapleNotes.Server.Tests.TestSupport;

/// <summary>
/// An account switched to end-to-end encryption the way the web app does it: the data key and recovery key are
/// created here, on the "client", and the server only receives them wrapped (docs/e2ee-spec.md §3, §6).
/// </summary>
/// <param name="UserId">The account.</param>
/// <param name="DataKey">The end-to-end data key, which the server never sees.</param>
/// <param name="RecoveryKey">The recovery key, which the server never sees.</param>
internal sealed record EndToEndAccount(Guid UserId, byte[] DataKey, byte[] RecoveryKey)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    /// <summary>Switches the account signed in on <paramref name="client"/> to end-to-end encryption.</summary>
    public static async Task<EndToEndAccount> EnableAsync(ApiClient client, string password = ApiClient.DefaultPassword)
    {
        var (request, account) = await EnableRequestAsync(client, password);
        (await client.PostJsonAsync("/api/v1/account/e2ee", request)).EnsureSuccessStatusCode();
        return account;
    }

    /// <summary>Builds the request that switches the signed-in account to end-to-end encryption.</summary>
    public static async Task<(EnableEndToEndRequest Request, EndToEndAccount Account)> EnableRequestAsync(
        ApiClient client, string password = ApiClient.DefaultPassword)
    {
        var userId = (await client.GetJsonAsync<UserResponse>("/api/v1/auth/me"))!.Id;
        var wrapKey = ApiClient.DeriveKeys(password, (await client.PreloginAsync(client.Username!)).Kdf).WrapKey;
        var account = new EndToEndAccount(userId, RandomNumberGenerator.GetBytes(32), RandomNumberGenerator.GetBytes(32));
        var (recoveryWrap, recoveryAuth) = E2eeCrypto.RecoveryKeys(account.RecoveryKey);
        var request = new EnableEndToEndRequest(
            await client.ProofAsync(password),
            E2eeCrypto.Seal(wrapKey, account.DataKey, E2eeCrypto.DataKeyContext(userId)),
            E2eeCrypto.Seal(recoveryWrap, account.DataKey, E2eeCrypto.RecoveryContext(userId)),
            recoveryAuth);
        return (request, account);
    }

    /// <summary>Fetches the wrapped key and unwraps it with <paramref name="password"/>, as the unlock screen does.</summary>
    public async Task<byte[]> UnlockAsync(ApiClient client, string password = ApiClient.DefaultPassword)
    {
        var wrapped = (await client.GetJsonAsync<E2eeKeyResponse>("/api/v1/account/e2ee"))!.WrappedKey;
        var wrapKey = ApiClient.DeriveKeys(password, (await client.PreloginAsync(client.Username!)).Kdf).WrapKey;
        return E2eeCrypto.Open(wrapKey, wrapped, E2eeCrypto.DataKeyContext(UserId));
    }

    /// <summary>Wraps the data key for a new password with the given parameters.</summary>
    public byte[] WrapFor(string password, KdfParameters kdf) =>
        E2eeCrypto.Seal(ApiClient.DeriveKeys(password, kdf).WrapKey, DataKey, E2eeCrypto.DataKeyContext(UserId));

    /// <summary>Encrypts note text and its tags as the web app does (docs/e2ee-spec.md §2, §4).</summary>
    public EncryptedNote EncryptNote(Guid noteId, string text) =>
        new(E2eeCrypto.EncryptNote(DataKey, UserId, noteId, text), TagParser.Extract(text).Select(EncryptTag).ToList());

    /// <summary>A tag's blind token and encrypted name.</summary>
    public EncryptedTag EncryptTag(string name)
    {
        var token = E2eeCrypto.TagToken(DataKey, name);
        return new EncryptedTag(token, E2eeCrypto.EncryptTagName(DataKey, UserId, token, name));
    }

    /// <summary>The blind token of a tag name.</summary>
    public string Token(string name) => E2eeCrypto.TagToken(DataKey, name);

    /// <summary>Decrypts a note returned by the API.</summary>
    public string Decrypt(NoteResponse note) => E2eeCrypto.DecryptNote(DataKey, UserId, note.Id, note.EncryptedContent!);

    /// <summary>Decrypts the name of an end-to-end tag returned by the API.</summary>
    public string DecryptName(TagResponse tag) =>
        Encoding.UTF8.GetString(E2eeCrypto.Open(E2eeCrypto.SubKeys(DataKey).Metadata, tag.EncryptedName!, E2eeCrypto.TagContext(UserId, tag.Token!)));

    /// <summary>Reads a JSON response body.</summary>
    public static async Task<T> ReadAsync<T>(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<T>(ApiClient.Json, Ct))!;
}
