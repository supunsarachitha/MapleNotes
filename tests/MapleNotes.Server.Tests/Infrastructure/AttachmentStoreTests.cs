using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Storage;
using MapleNotes.Server.Tests.TestSupport;

namespace MapleNotes.Server.Tests.Infrastructure;

public sealed class AttachmentStoreTests : IDisposable
{
    private readonly TempDirectory _dir = new();
    private readonly AttachmentStore _store;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public AttachmentStoreTests()
    {
        _store = new AttachmentStore(new MapleOptions { DataDirectory = _dir.Path });
    }

    [Fact]
    public void Storage_keys_shard_by_the_random_tail_of_the_id()
    {
        var id = Guid.Parse("0192f3a1-7c2e-7d4b-9a1c-3e5f7a9b1c2d");

        Assert.Equal("2d/1c/0192f3a17c2e7d4b9a1c3e5f7a9b1c2d.bin", AttachmentStore.CreateStorageKey(id));
    }

    [Fact]
    public async Task Writes_and_reads_back_content()
    {
        var key = AttachmentStore.CreateStorageKey(Guid.CreateVersion7());

        await _store.WriteAsync(key, (stream, ct) => stream.WriteAsync("hello"u8.ToArray(), ct).AsTask(),
            cancellationToken: Ct);

        await using var file = _store.OpenRead(key);
        using var reader = new StreamReader(file);
        Assert.Equal("hello", await reader.ReadToEndAsync(TestContext.Current.CancellationToken));
        Assert.True(_store.Exists(key));
        Assert.Empty(Directory.GetFiles(_dir.Path, "*.tmp", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Refuses_to_overwrite_unless_asked()
    {
        var key = AttachmentStore.CreateStorageKey(Guid.CreateVersion7());
        await _store.WriteAsync(key, (s, ct) => s.WriteAsync("one"u8.ToArray(), ct).AsTask(), cancellationToken: Ct);

        await Assert.ThrowsAsync<IOException>(() => _store.WriteAsync(key, (s, ct) => s.WriteAsync("two"u8.ToArray(), ct).AsTask(), cancellationToken: Ct));
        await _store.WriteAsync(key, (s, ct) => s.WriteAsync("three"u8.ToArray(), ct).AsTask(), overwrite: true, cancellationToken: Ct);

        await using var file = _store.OpenRead(key);
        Assert.Equal("three", await new StreamReader(file).ReadToEndAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Failed_write_leaves_nothing_behind()
    {
        var key = AttachmentStore.CreateStorageKey(Guid.CreateVersion7());

        await Assert.ThrowsAsync<InvalidOperationException>(() => _store.WriteAsync(key, async (stream, ct) =>
        {
            await stream.WriteAsync("partial"u8.ToArray(), ct);
            throw new InvalidOperationException("upload aborted");
        }, cancellationToken: Ct));

        Assert.False(_store.Exists(key));
        Assert.Empty(Directory.GetFiles(_dir.Path, "*", SearchOption.AllDirectories));
    }

    [Theory]
    [InlineData("../maple.db")]
    [InlineData("ab/cd/../../../maple.db")]
    [InlineData("/etc/passwd")]
    [InlineData("ab/cd/0192f3a17c2e7d4b9a1c3e5f7a9b1c2d.exe")]
    [InlineData("AB/CD/0192F3A17C2E7D4B9A1C3E5F7A9B1C2D.bin")]
    public void Rejects_storage_keys_that_could_escape_the_store(string storageKey)
    {
        Assert.Throws<ArgumentException>(() => _store.OpenRead(storageKey));
        Assert.Throws<ArgumentException>(() => _store.Delete(storageKey));
    }

    [Fact]
    public void Deleting_a_missing_file_is_harmless()
    {
        _store.Delete(AttachmentStore.CreateStorageKey(Guid.CreateVersion7()));
    }

    [Fact]
    public async Task Lists_stored_files()
    {
        var keys = new[] { AttachmentStore.CreateStorageKey(Guid.CreateVersion7()), AttachmentStore.CreateStorageKey(Guid.CreateVersion7()) };
        foreach (var key in keys)
        {
            await _store.WriteAsync(key, (s, ct) => s.WriteAsync(new byte[] { 1 }, ct).AsTask(), cancellationToken: Ct);
        }

        Assert.Equal(keys.Order(), _store.EnumerateStorageKeys().Order());
    }

    [Fact]
    public void Removes_only_stale_temporary_files()
    {
        var shard = Path.Combine(_dir.Path, "attachments", "ab", "cd");
        Directory.CreateDirectory(shard);
        var stale = Path.Combine(shard, ".x.bin.1.tmp");
        var fresh = Path.Combine(shard, ".y.bin.2.tmp");
        File.WriteAllBytes(stale, [1]);
        File.WriteAllBytes(fresh, [1]);
        File.SetLastWriteTimeUtc(stale, DateTime.UtcNow.AddDays(-2));

        var removed = _store.DeleteStaleTemporaryFiles(TimeSpan.FromHours(1));

        Assert.Equal(1, removed);
        Assert.False(File.Exists(stale));
        Assert.True(File.Exists(fresh));
    }

    public void Dispose() => _dir.Dispose();
}
