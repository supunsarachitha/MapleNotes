using System.Text.Json;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.EndToEnd;
using MapleNotes.Server.Features.Labels;

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
            if (batch.Notes.Count + batch.Attachments.Count + (batch.Labels?.Count ?? 0) == 0)
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
                    ? new ConvertNoteRequest(note.UpdatedAtUtc, Encrypted: account.EncryptNote(note.Id, note.Content!, note.Mood?.ToString().ToLowerInvariant() ?? "none"))
                    : new ConvertNoteRequest(note.UpdatedAtUtc, Content: E2eeCrypto.DecryptNote(account.DataKey, account.UserId, note.Id, note.EncryptedContent!),
                        Mood: note.EncryptedMood is { } mood ? Enum.Parse<NoteMood>(E2eeCrypto.OpenMood(account.DataKey, account.UserId, note.Id, mood), ignoreCase: true) : null);
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
                    var metadata = account.SealMetadata(file.Id, file.FileName!, file.ContentType!, stored.Length, file.IsSticker);
                    response = await client.PutFileAsync($"/api/v1/account/conversion/attachments/{file.Id}", account.EncryptFile(file.Id, stored),
                        "encrypted.bin", "application/octet-stream", new Dictionary<string, string> { ["metadata"] = Convert.ToBase64String(metadata) });
                }
                else
                {
                    using var metadata = JsonDocument.Parse(account.OpenMetadata(file.Id, file.EncryptedMetadata!));
                    var sticker = metadata.RootElement.TryGetProperty("sticker", out var flag) && flag.ValueKind == JsonValueKind.Number && flag.GetInt32() == 1;
                    response = await client.PutFileAsync($"/api/v1/account/conversion/attachments/{file.Id}", account.DecryptFile(file.Id, stored),
                        metadata.RootElement.GetProperty("name").GetString()!, metadata.RootElement.GetProperty("type").GetString()!,
                        sticker ? new Dictionary<string, string> { ["sticker"] = "true" } : null);
                }

                response.EnsureSuccessStatusCode();
                converted++;
            }

            foreach (var label in batch.Labels ?? [])
            {
                if (converted == maxItems)
                {
                    return converted;
                }

                var request = entering
                    ? new UpdateLabelRequest(EncryptedName: account.EncryptLabelName(label.Id, label.Name!))
                    : new UpdateLabelRequest(Name: account.DecryptLabelName(label.Id, label.EncryptedName!));
                (await client.PutJsonAsync($"/api/v1/labels/{label.Id}", request)).EnsureSuccessStatusCode();
                converted++;
            }
        }

        return converted;
    }
}
