using System.Security.Cryptography;
using System.Text.RegularExpressions;
using MapleNotes.Server.Infrastructure.Configuration;

namespace MapleNotes.Server.Infrastructure.Storage;

/// <summary>
/// Stores attachment files under <c>{data}/attachments</c>. Content is written by the caller (encrypted or not);
/// this class only manages paths and makes writes atomic.
/// </summary>
/// <remarks>
/// Files are named by attachment ID plus a random suffix and spread over two directory levels taken from the random
/// tail of the UUID (<c>attachments/3f/9a/{id}-{suffix}.bin</c>), so no directory grows too large. Each write of an
/// attachment's content gets a fresh name, which lets re-encryption write the new version next to the old one and
/// switch over atomically in the database. A storage key is the path relative to the attachments directory; it is
/// validated before use, so a tampered database row cannot point outside the store.
/// </remarks>
/// <param name="options">Instance settings.</param>
public sealed partial class AttachmentStore(MapleOptions options)
{
    /// <summary>Returns a new, unique storage key for an attachment's content.</summary>
    /// <param name="attachmentId">The attachment's ID.</param>
    /// <returns>A relative path such as <c>3f/9a/0192…-5d1e0a7c.bin</c>.</returns>
    public static string CreateStorageKey(Guid attachmentId)
    {
        var name = attachmentId.ToString("N");
        var suffix = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(4));
        return $"{name[30..32]}/{name[28..30]}/{name}-{suffix}.bin";
    }

    /// <summary>
    /// Writes a file atomically: content goes to a temporary file in the same directory, is flushed to disk, and is
    /// then renamed into place, so readers never observe a partially written file.
    /// </summary>
    /// <param name="storageKey">Destination storage key.</param>
    /// <param name="write">Writes the content to the provided stream.</param>
    /// <param name="overwrite">Whether to replace an existing file (used when re-encrypting).</param>
    /// <param name="cancellationToken">Cancels the operation; the temporary file is removed.</param>
    /// <returns>A task that completes when the file is in place.</returns>
    public async Task WriteAsync(
        string storageKey, Func<Stream, CancellationToken, Task> write, bool overwrite = false,
        CancellationToken cancellationToken = default)
    {
        var path = ResolvePath(storageKey);
        var directory = Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(directory);
        var temporaryPath = Path.Combine(directory, $".{Path.GetFileName(path)}.{Guid.NewGuid():N}.tmp");

        try
        {
            await using (var file = new FileStream(temporaryPath, new FileStreamOptions
            {
                Mode = FileMode.CreateNew,
                Access = FileAccess.Write,
                Share = FileShare.None,
                Options = FileOptions.Asynchronous,
            }))
            {
                await write(file, cancellationToken);
                await file.FlushAsync(cancellationToken);
                file.Flush(flushToDisk: true);
            }

            File.Move(temporaryPath, path, overwrite);
        }
        catch
        {
            TryDelete(temporaryPath);
            throw;
        }
    }

    /// <summary>Opens a stored file for reading (seekable, asynchronous).</summary>
    /// <param name="storageKey">The file's storage key.</param>
    /// <returns>The open file.</returns>
    /// <exception cref="FileNotFoundException">The file does not exist.</exception>
    public FileStream OpenRead(string storageKey) =>
        new(ResolvePath(storageKey), new FileStreamOptions
        {
            Mode = FileMode.Open,
            Access = FileAccess.Read,
            Share = FileShare.Read,
            Options = FileOptions.Asynchronous,
        });

    /// <summary>Returns when a stored file was last written (UTC).</summary>
    /// <param name="storageKey">The file's storage key.</param>
    /// <returns>The last write time.</returns>
    public DateTime GetLastWriteTimeUtc(string storageKey) => File.GetLastWriteTimeUtc(ResolvePath(storageKey));

    /// <summary>Returns whether a stored file exists.</summary>
    /// <param name="storageKey">The file's storage key.</param>
    /// <returns>True when the file exists.</returns>
    public bool Exists(string storageKey) => File.Exists(ResolvePath(storageKey));

    /// <summary>Deletes a stored file if it exists.</summary>
    /// <param name="storageKey">The file's storage key.</param>
    public void Delete(string storageKey)
    {
        try
        {
            File.Delete(ResolvePath(storageKey));
        }
        catch (DirectoryNotFoundException)
        {
            // The shard directory was never created, so the file is already gone.
        }
    }

    /// <summary>
    /// Lists the storage keys of all files in the store (used to find files no database row refers to).
    /// </summary>
    /// <returns>Storage keys of the stored files.</returns>
    public IEnumerable<string> EnumerateStorageKeys()
    {
        if (!Directory.Exists(options.AttachmentsDirectory))
        {
            yield break;
        }

        foreach (var path in Directory.EnumerateFiles(options.AttachmentsDirectory, "*.bin", SearchOption.AllDirectories))
        {
            var key = Path.GetRelativePath(options.AttachmentsDirectory, path).Replace('\\', '/');
            if (StorageKeyPattern().IsMatch(key))
            {
                yield return key;
            }
        }
    }

    /// <summary>
    /// Deletes temporary files left behind by writes that were interrupted (for example by a crash).
    /// </summary>
    /// <param name="olderThan">Only files older than this are removed, so in-progress writes are left alone.</param>
    /// <returns>Number of files removed.</returns>
    public int DeleteStaleTemporaryFiles(TimeSpan olderThan)
    {
        if (!Directory.Exists(options.AttachmentsDirectory))
        {
            return 0;
        }

        var cutoff = DateTime.UtcNow - olderThan;
        var removed = 0;
        foreach (var path in Directory.EnumerateFiles(options.AttachmentsDirectory, ".*.tmp", SearchOption.AllDirectories))
        {
            if (File.GetLastWriteTimeUtc(path) < cutoff && TryDelete(path))
            {
                removed++;
            }
        }

        return removed;
    }

    private string ResolvePath(string storageKey)
    {
        if (!StorageKeyPattern().IsMatch(storageKey))
        {
            throw new ArgumentException("Invalid attachment storage key.", nameof(storageKey));
        }

        return Path.Combine(options.AttachmentsDirectory, storageKey.Replace('/', Path.DirectorySeparatorChar));
    }

    private static bool TryDelete(string path)
    {
        try
        {
            File.Delete(path);
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    [GeneratedRegex("^[0-9a-f]{2}/[0-9a-f]{2}/[0-9a-f]{32}(-[0-9a-f]{8})?\\.bin$", RegexOptions.CultureInvariant)]
    private static partial Regex StorageKeyPattern();
}
