using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Notes;

namespace MapleNotes.Server.Tests.Notes;

public sealed class TagParserTests
{
    [Theory]
    [InlineData("Buy milk #groceries", new[] { "groceries" })]
    [InlineData("#Work and #work and #WORK", new[] { "work" })]
    [InlineData("#work/meetings/weekly notes", new[] { "work/meetings/weekly" })]
    [InlineData("Unicode #café #日本", new[] { "café", "日本" })]
    [InlineData("#a, #b. #c!", new[] { "a", "b", "c" })]
    [InlineData("trailing #slash/ and #dash-", new[] { "slash", "dash" })]
    public void Finds_tags(string markdown, string[] expected)
    {
        Assert.Equal(expected, TagParser.Extract(markdown));
    }

    [Fact]
    public void Pathological_input_cannot_stall_tag_parsing()
    {
        var hostile = string.Concat(Enumerable.Repeat("```#a`", 20_000)) + new string('#', 50_000);

        var watch = System.Diagnostics.Stopwatch.StartNew();
        TagParser.Extract(hostile);

        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(5));
    }

    [Theory]
    [InlineData("# Heading")]
    [InlineData("## Second level")]
    [InlineData("see https://example.com/page#section")]
    [InlineData("see example.com/#anchor")]
    [InlineData("an&#39;entity")]
    [InlineData("issue #123")]
    [InlineData("word#nottag")]
    [InlineData("`#inline` code")]
    [InlineData("```\n#fenced code\n```")]
    [InlineData("```\n#unclosed fence")]
    public void Ignores_things_that_are_not_tags(string markdown)
    {
        Assert.Empty(TagParser.Extract(markdown));
    }
}

public sealed class NoteCursorTests
{
    [Fact]
    public void Round_trips()
    {
        var cursor = new NoteCursor(new DateTime(2026, 9, 28, 12, 34, 56, DateTimeKind.Utc).AddTicks(1234), Guid.CreateVersion7());

        Assert.True(NoteCursor.TryParse(cursor.Encode(), out var parsed));
        Assert.Equal(cursor, parsed);
        Assert.Equal(DateTimeKind.Utc, parsed.CreatedAtUtc.Kind);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-base64!")]
    [InlineData("MTIz")]                                            // "123": no ID
    [InlineData("LTEuMDE5MmYzYTE3YzJlN2Q0YjlhMWMzZTVmN2E5YjFjMmQ")] // negative ticks
    public void Rejects_invalid_cursors(string? value)
    {
        Assert.False(NoteCursor.TryParse(value, out _));
    }
}

public sealed class UploadPolicyTests
{
    [Theory]
    [InlineData("photo.png", "photo.png")]
    [InlineData("../../etc/passwd", "passwd")]
    [InlineData(@"C:\Users\me\report.pdf", "report.pdf")]
    [InlineData("  ..hidden..  ", "hidden")]
    [InlineData("bad<>:\"|?*name.txt", "badname.txt")]
    [InlineData("tab\tname\u0000.txt", "tabname.txt")]
    [InlineData("", "file")]
    [InlineData(null, "file")]
    [InlineData("日本語のファイル.txt", "日本語のファイル.txt")]
    public void Sanitizes_file_names(string? input, string expected)
    {
        Assert.Equal(expected, UploadPolicy.SanitizeFileName(input));
    }

    [Fact]
    public void Truncates_long_names_keeping_the_extension()
    {
        var name = UploadPolicy.SanitizeFileName(new string('a', 500) + ".jpeg");

        Assert.Equal(200, name.Length);
        Assert.EndsWith(".jpeg", name, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("image/PNG", "x.bin", "image/png")]
    [InlineData("text/plain; charset=utf-8", "x", "text/plain")]
    [InlineData(null, "photo.jpg", "image/jpeg")]
    [InlineData("application/octet-stream", "clip.mp4", "video/mp4")]
    [InlineData("", "unknown.zzz", "application/octet-stream")]
    [InlineData("not a type", "notes.txt", "text/plain")]
    public void Resolves_content_types(string? declared, string fileName, string expected)
    {
        Assert.Equal(expected, UploadPolicy.ResolveContentType(declared, fileName));
    }

    [Theory]
    [InlineData("image/png", true)]
    [InlineData("video/mp4", true)]
    [InlineData("text/plain", true)]
    [InlineData("image/svg+xml", false)]
    [InlineData("text/html", false)]
    [InlineData("application/pdf", false)]
    public void Only_passive_media_is_displayed_inline(string contentType, bool inline)
    {
        Assert.Equal(inline, UploadPolicy.CanDisplayInline(contentType));
    }
}
