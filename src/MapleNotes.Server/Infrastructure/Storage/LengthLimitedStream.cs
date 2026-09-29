namespace MapleNotes.Server.Infrastructure.Storage;

/// <summary>Thrown when an upload exceeds the configured maximum size.</summary>
/// <param name="limit">The limit in bytes.</param>
public sealed class UploadTooLargeException(long limit)
    : Exception($"The upload exceeds the maximum size of {limit / (1024 * 1024)} MB.")
{
    /// <summary>The limit in bytes.</summary>
    public long Limit { get; } = limit;
}

/// <summary>
/// A read-only wrapper that counts bytes and fails as soon as more than <c>limit</c> bytes are read, so oversized
/// uploads are rejected while streaming instead of after being stored.
/// </summary>
/// <param name="inner">The stream to read from.</param>
/// <param name="limit">Maximum number of bytes allowed.</param>
internal sealed class LengthLimitedStream(Stream inner, long limit) : Stream
{
    /// <summary>Bytes read so far.</summary>
    public long BytesRead { get; private set; }

    /// <inheritdoc />
    public override bool CanRead => true;

    /// <inheritdoc />
    public override bool CanSeek => false;

    /// <inheritdoc />
    public override bool CanWrite => false;

    /// <inheritdoc />
    public override long Length => throw new NotSupportedException();

    /// <inheritdoc />
    public override long Position
    {
        get => BytesRead;
        set => throw new NotSupportedException();
    }

    /// <inheritdoc />
    public override int Read(byte[] buffer, int offset, int count) => Count(inner.Read(buffer, offset, count));

    /// <inheritdoc />
    public override int Read(Span<byte> buffer) => Count(inner.Read(buffer));

    /// <inheritdoc />
    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
        Count(await inner.ReadAsync(buffer, cancellationToken));

    /// <inheritdoc />
    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
        ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    /// <inheritdoc />
    public override void Flush()
    {
    }

    /// <inheritdoc />
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    /// <inheritdoc />
    public override void SetLength(long value) => throw new NotSupportedException();

    /// <inheritdoc />
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    private int Count(int read)
    {
        BytesRead += read;
        if (BytesRead > limit)
        {
            throw new UploadTooLargeException(limit);
        }

        return read;
    }
}
