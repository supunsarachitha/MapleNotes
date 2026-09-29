using System.Net.Http.Json;
using System.Text.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.EndToEnd;

namespace MapleNotes.Server.Tests.TestSupport;

/// <summary>
/// Does what the web app does after a change to or from end-to-end encryption: fetches batches of items and converts
/// them one by one (docs/e2ee-spec.md §3). Can stop part-way, to simulate a closed tab or a crash.
/// </summary>
internal sealed class BrowserConverter(ApiClient client, EndToEndAccount account)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    /// <summary>Converts up to <paramref name="maxItems"/> items (all when null), in batches of <paramref name="batchSize"/>.</summary>
    /// <returns>How many items were converted.</returns>
    public async Task<int> RunAsync(int? maxItems = null, int batchSize = 2)
    {
        var converted = 0;
        while (maxItems is null || converted < maxItems)
        {
            var batch = (await client.GetJsonAsync<ConversionBatchResponse>($"/api/v1/account/conversion?limit={batchSize}"))!;
            if (batch.Notes.Count + batch.Attachments.Count == 0)
            {
                return converted;
            }

            var entering = batch.Mode == EncryptionMode.EndToEnd;
            foreach (var note in batch.Notes)
            {
                if (converted == maxItems)
                {
                    return converted;
                }

                var request = entering
                    ? new ConvertNoteRequest(note.UpdatedAtUtc, Encrypted: account.EncryptNote(note.Id, note.Content!))
                    : new ConvertNoteRequest(note.UpdatedAtUtc, Content: E2eeCrypto.DecryptNote(account.DataKey, account.UserId, note.Id, note.EncryptedContent!));
                (await client.PutJsonAsync($"/api/v1/account/conversion/notes/{note.Id}", request)).EnsureSuccessStatusCode();
                converted++;
            }

            foreach (var file in batch.Attachments)
            {
                if (converted == maxItems)
                {
                    return converted;
                }

                var stored = await (await client.GetAsync($"/api/v1/attachments/{file.Id}")).Content.ReadAsByteArrayAsync(Ct);
                HttpResponseMessage response;
                if (entering)
                {
                    var metadata = account.SealMetadata(file.Id, file.FileName!, file.ContentType!, stored.Length);
                    response = await client.PutFileAsync($"/api/v1/account/conversion/attachments/{file.Id}", account.EncryptFile(file.Id, stored),
                        "encrypted.bin", "application/octet-stream", new Dictionary<string, string> { ["metadata"] = Convert.ToBase64String(metadata) });
                }
                else
                {
                    using var metadata = JsonDocument.Parse(account.OpenMetadata(file.Id, file.EncryptedMetadata!));
                    response = await client.PutFileAsync($"/api/v1/account/conversion/attachments/{file.Id}", account.DecryptFile(file.Id, stored),
                        metadata.RootElement.GetProperty("name").GetString()!, metadata.RootElement.GetProperty("type").GetString()!);
                }

                response.EnsureSuccessStatusCode();
                converted++;
            }
        }

        return converted;
    }
}
