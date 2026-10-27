using MapleNotes.Server.Domain;
using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace MapleNotes.Server.Features.Export;

/// <summary>Renders an exported note as Markdown, plain text or JSON.</summary>
public static class NoteFormatter
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping, // keep non-ASCII text readable in the exported files
    };

    /// <summary>The file extension for a format, without the dot.</summary>
    /// <param name="format">The format.</param>
    /// <returns><c>md</c>, <c>txt</c> or <c>json</c>.</returns>
    public static string Extension(ExportFormat format) => format switch
    {
        ExportFormat.Txt => "txt",
        ExportFormat.Json => "json",
        _ => "md",
    };

    /// <summary>Renders a note in the requested format.</summary>
    /// <param name="note">The note.</param>
    /// <param name="format">The format.</param>
    /// <returns>The file content.</returns>
    public static string Render(ExportedNote note, ExportFormat format) => format switch
    {
        ExportFormat.Txt => PlainText(note),
        ExportFormat.Json => Json(note),
        _ => Markdown(note),
    };

    /// <summary>
    /// Markdown with YAML front matter (id, kind, daily date, dates, tags, labels, state, mood, attachments, stickers), the original text, and an
    /// "Attachments" section that embeds images and links other files by relative path.
    /// </summary>
    /// <param name="note">The note.</param>
    /// <returns>The Markdown document.</returns>
    public static string Markdown(ExportedNote note)
    {
        var text = new StringBuilder();
        text.Append("---\n");
        text.Append("id: ").Append(note.Id).Append('\n');
        text.Append("kind: ").Append(note.KindName).Append('\n');
        if (note.DailyDate is { } daily)
        {
            text.Append("daily: ").Append(Date(daily)).Append('\n');
        }

        text.Append("created: ").Append(Timestamp(note.Created)).Append('\n');
        text.Append("updated: ").Append(Timestamp(note.Updated)).Append('\n');
        text.Append("tags: [").Append(string.Join(", ", note.Tags.Select(Quote))).Append("]\n");
        text.Append("labels: [").Append(string.Join(", ", note.LabelNames.Select(Quote))).Append("]\n");
        text.Append("pinned: ").Append(note.Pinned ? "true" : "false").Append('\n');
        text.Append("archived: ").Append(note.Archived ? "true" : "false").Append('\n');
        if (note.MoodName is { } mood)
        {
            text.Append("mood: ").Append(mood).Append('\n');
        }

        if (note.Attachments.Count > 0)
        {
            text.Append("attachments:\n");
            foreach (var attachment in note.Attachments)
            {
                text.Append("  - ").Append(Quote(attachment.RelativePath)).Append('\n');
            }
        }

        if (note.Stickers.Count > 0)
        {
            // Which of the files above are stickers. Readers from before stickers read the first list only, and show
            // them as pictures.
            text.Append("stickers:\n");
            foreach (var sticker in note.Stickers)
            {
                text.Append("  - ").Append(Quote(sticker.RelativePath)).Append('\n');
            }
        }

        text.Append("---\n\n");
        text.Append(note.Content.TrimEnd()).Append('\n');

        if (note.Attachments.Count > 0)
        {
            text.Append("\n## Attachments\n\n");
            foreach (var attachment in note.Attachments)
            {
                var label = EscapeLinkText(attachment.FileName);
                var target = ExportNaming.LinkTarget(attachment.RelativePath);
                text.Append(attachment.IsImage ? $"- ![{label}]({target})\n" : $"- [{label}]({target})\n");
            }
        }

        return text.ToString();
    }

    /// <summary>
    /// Plain text: a short header (dates, kind and daily date when they matter, tags, labels, state, mood, attachment and sticker paths), a blank
    /// line, then the note text.
    /// </summary>
    /// <param name="note">The note.</param>
    /// <returns>The text document.</returns>
    public static string PlainText(ExportedNote note)
    {
        var text = new StringBuilder();
        text.Append("Created: ").Append(Timestamp(note.Created)).Append('\n');
        if (note.Updated - note.Created > TimeSpan.FromMinutes(1))
        {
            text.Append("Updated: ").Append(Timestamp(note.Updated)).Append('\n');
        }

        if (note.Kind != NoteKind.Note)
        {
            text.Append("Kind: ").Append(note.KindName).Append('\n');
        }

        if (note.DailyDate is { } daily)
        {
            text.Append("Daily: ").Append(Date(daily)).Append('\n');
        }

        if (note.Tags.Count > 0)
        {
            text.Append("Tags: ").Append(string.Join(' ', note.Tags.Select(t => "#" + t))).Append('\n');
        }

        if (note.LabelNames.Count > 0)
        {
            // As a JSON array: label names may contain spaces and commas.
            text.Append("Labels: [").Append(string.Join(", ", note.LabelNames.Select(Quote))).Append("]\n");
        }

        if (note.Pinned || note.Archived)
        {
            text.Append("State: ").Append(string.Join(", ", new[] { note.Pinned ? "pinned" : null, note.Archived ? "archived" : null }.OfType<string>())).Append('\n');
        }

        if (note.MoodName is { } mood)
        {
            text.Append("Mood: ").Append(mood).Append('\n');
        }

        foreach (var attachment in note.Attachments)
        {
            text.Append("Attachment: ").Append(attachment.RelativePath).Append('\n');
        }

        foreach (var sticker in note.Stickers)
        {
            text.Append("Sticker: ").Append(sticker.RelativePath).Append('\n');
        }

        text.Append('\n').Append(note.Content.TrimEnd()).Append('\n');
        return text.ToString();
    }

    /// <summary>One JSON document with the note and its metadata.</summary>
    /// <param name="note">The note.</param>
    /// <returns>The JSON document.</returns>
    public static string Json(ExportedNote note)
    {
        var document = new
        {
            note.Id,
            Kind = note.KindName,
            DailyDate = note.DailyDate is { } daily ? Date(daily) : null,
            CreatedAt = Timestamp(note.Created),
            UpdatedAt = Timestamp(note.Updated),
            note.Tags,
            Labels = note.LabelNames,
            note.Pinned,
            note.Archived,
            note.Content,
            Attachments = note.Attachments.Select(a => new { a.FileName, a.ContentType, a.SizeBytes, Path = a.RelativePath }),
        };
        if (note.MoodName is null && note.Stickers.Count == 0)
        {
            return JsonSerializer.Serialize(document, JsonOptions) + "\n";
        }

        // As Falcon Notes 1.7.0 defined them: the mood after "archived", the stickers' paths last.
        var extended = JsonSerializer.SerializeToNode(document, JsonOptions)!.AsObject();
        if (note.MoodName is { } mood)
        {
            extended.Insert(extended.IndexOf("archived") + 1, "mood", mood);
        }

        if (note.Stickers.Count > 0)
        {
            extended.Add("stickers", new JsonArray(note.Stickers.Select(s => (JsonNode?)JsonValue.Create(s.RelativePath)).ToArray()));
        }

        return extended.ToJsonString(JsonOptions) + "\n";
    }

    /// <summary>Serializes the export manifest.</summary>
    /// <param name="manifest">The manifest object.</param>
    /// <returns>Indented JSON.</returns>
    public static string ManifestJson(object manifest) => JsonSerializer.Serialize(manifest, JsonOptions) + "\n";

    private static string Date(DateOnly value) => value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string Timestamp(DateTimeOffset value) =>
        value.ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture);

    // YAML accepts JSON strings, which avoids every YAML quoting pitfall (colons, #, leading dashes, Unicode…).
    private static string Quote(string value) => JsonSerializer.Serialize(value, JsonOptions);

    private static string EscapeLinkText(string text) =>
        text.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("[", "\\[", StringComparison.Ordinal)
            .Replace("]", "\\]", StringComparison.Ordinal);
}
