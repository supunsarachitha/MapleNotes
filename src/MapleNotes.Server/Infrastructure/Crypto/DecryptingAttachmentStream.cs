using System.Security.Cryptography;

namespace MapleNotes.Server.Infrastructure.Crypto;

/// <summary>
/// A read-only, seekable stream that decrypts an attachment written by <see cref="AttachmentCipher"/> on the fly.
/// </summary>
/// <remarks>
/// Because the stream reports its plaintext <see cref="Length"/> and supports seeking, ASP.NET Core can serve HTTP
/// Range requests from it directly: only the 64 KiB chunks that overlap the requested range are read and decrypted.
/// Each chunk is authenticated before any of its bytes are returned. Truncation of the file is detected when the
/// reader reaches the (missing) final chunk; a <see cref="CryptographicException"/> is thrown for any tampering.
/// </remarks>
internal sealed class DecryptingAttachmentStream : Stream
{
    private readonly Stream _inner;
    private readonly AesGcm _aes;
    private readonly byte[] _associatedData;
    private readonly int _chunkSize;
    private readonly long _chunkCount;
    private readonly int _lastChunkCipherLength;
    private readonly long _length;
    private readonly byte[] _cipherBuffer;
    private readonly byte[] _plainBuffer;

    private long _bufferedChunk = -1;
    private int _bufferedLength;
    private long _position;
    private bool _disposed;

    private DecryptingAttachmentStream(
        Stream inner, AesGcm aes, byte[] associatedData, int chunkSize, long chunkCount, int lastChunkCipherLength)
    {
        _inner = inner;
        _aes = aes;
        _associatedData = associatedData;
        _chunkSize = chunkSize;
        _chunkCount = chunkCount;
        _lastChunkCipherLength = lastChunkCipherLength;
        _length = (chunkCount - 1) * chunkSize + (lastChunkCipherLength - AttachmentCipher.TagSize);
        _cipherBuffer = new byte[chunkSize + AttachmentCipher.TagSize];
        _plainBuffer = new byte[chunkSize];
    }

    /// <summary>
    /// Validates the header of an encrypted attachment and returns a stream over its plaintext.
    /// </summary>
    /// <param name="encrypted">The encrypted file; must be readable and seekable. Ownership passes to the new stream.</param>
    /// <param name="key">The owner's data key.</param>
    /// <param name="userId">The owner's ID.</param>
    /// <param name="attachmentId">The attachment's ID.</param>
    /// <returns>A stream over the decrypted content.</returns>
    /// <exception cref="CryptographicException">The file is not a valid encrypted attachment or is truncated.</exception>
    public static DecryptingAttachmentStream Open(Stream encrypted, UserDataKey key, Guid userId, Guid attachmentId)
    {
        ArgumentNullException.ThrowIfNull(encrypted);
        if (!encrypted.CanRead || !encrypted.CanSeek)
        {
            throw new ArgumentException("The encrypted stream must be readable and seekable.", nameof(encrypted));
        }

        var header = new byte[AttachmentCipher.HeaderSize];
        encrypted.Position = 0;
        try
        {
            encrypted.ReadExactly(header);
        }
        catch (EndOfStreamException ex)
        {
            throw new CryptographicException("The attachment file is truncated.", ex);
        }

        var (keyVersion, chunkSize, salt) = AttachmentCipher.ParseHeader(header);
        if (keyVersion != key.Version)
        {
            throw new CryptographicException(
                $"The attachment was encrypted with data key version {keyVersion}, but version {key.Version} was supplied.");
        }

        var bodyLength = encrypted.Length - AttachmentCipher.HeaderSize;
        var stride = (long)chunkSize + AttachmentCipher.TagSize;
        if (bodyLength < AttachmentCipher.TagSize)
        {
            throw new CryptographicException("The attachment file is truncated.");
        }

        var chunkCount = (bodyLength + stride - 1) / stride;
        var lastChunkCipherLength = (int)(bodyLength - (chunkCount - 1) * stride);
        if (lastChunkCipherLength < AttachmentCipher.TagSize || chunkCount > uint.MaxValue + 1L)
        {
            throw new CryptographicException("The attachment file is truncated or corrupt.");
        }

        var fileKey = AttachmentCipher.DeriveFileKey(key.Span, salt);
        try
        {
            var aes = new AesGcm(fileKey, AttachmentCipher.TagSize);
            var associatedData = AttachmentCipher.BuildAssociatedData(header, userId, attachmentId);
            return new DecryptingAttachmentStream(encrypted, aes, associatedData, chunkSize, chunkCount, lastChunkCipherLength);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(fileKey);
        }
    }

    /// <inheritdoc />
    public override bool CanRead => !_disposed;

    /// <inheritdoc />
    public override bool CanSeek => !_disposed;

    /// <inheritdoc />
    public override bool CanWrite => false;

    /// <summary>Length of the decrypted content.</summary>
    public override long Length => _length;

    /// <inheritdoc />
    public override long Position
    {
        get => _position;
        set => Seek(value, SeekOrigin.Begin);
    }

    /// <inheritdoc />
    public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));

    /// <inheritdoc />
    public override int Read(Span<byte> buffer)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (buffer.IsEmpty || _position >= _length)
        {
            return 0;
        }

        var chunk = _position / _chunkSize;
        if (chunk != _bufferedChunk)
        {
            var (offset, cipherLength) = Locate(chunk);
            _bufferedChunk = -1;
            _inner.Position = offset;
            try
            {
                _inner.ReadExactly(_cipherBuffer, 0, cipherLength);
            }
            catch (EndOfStreamException ex)
            {
                throw new CryptographicException("The attachment file is truncated.", ex);
            }

            DecryptBufferedChunk(chunk, cipherLength);
        }

        return CopyFromPlainBuffer(buffer, chunk);
    }

    /// <inheritdoc />
    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
        ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

    /// <inheritdoc />
    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (buffer.IsEmpty || _position >= _length)
        {
            return 0;
        }

        var chunk = _position / _chunkSize;
        if (chunk != _bufferedChunk)
        {
            var (offset, cipherLength) = Locate(chunk);
            _bufferedChunk = -1;
            _inner.Position = offset;
            try
            {
                await _inner.ReadExactlyAsync(_cipherBuffer.AsMemory(0, cipherLength), cancellationToken);
            }
            catch (EndOfStreamException ex)
            {
                throw new CryptographicException("The attachment file is truncated.", ex);
            }

            DecryptBufferedChunk(chunk, cipherLength);
        }

        return CopyFromPlainBuffer(buffer.Span, chunk);
    }

    /// <inheritdoc />
    public override long Seek(long offset, SeekOrigin origin)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var target = origin switch
        {
            SeekOrigin.Begin => offset,
            SeekOrigin.Current => _position + offset,
            SeekOrigin.End => _length + offset,
            _ => throw new ArgumentOutOfRangeException(nameof(origin)),
        };

        ArgumentOutOfRangeException.ThrowIfNegative(target, nameof(offset));
        _position = target;
        return _position;
    }

    /// <inheritdoc />
    public override void Flush()
    {
    }

    /// <inheritdoc />
    public override void SetLength(long value) => throw new NotSupportedException();

    /// <inheritdoc />
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    /// <inheritdoc />
    protected override void Dispose(bool disposing)
    {
        if (!_disposed && disposing)
        {
            _disposed = true;
            _aes.Dispose();
            _inner.Dispose();
            CryptographicOperations.ZeroMemory(_plainBuffer);
        }

        base.Dispose(disposing);
    }

    /// <inheritdoc />
    public override async ValueTask DisposeAsync()
    {
        if (!_disposed)
        {
            _disposed = true;
            _aes.Dispose();
            await _inner.DisposeAsync();
            CryptographicOperations.ZeroMemory(_plainBuffer);
        }

        GC.SuppressFinalize(this);
    }

    private (long Offset, int CipherLength) Locate(long chunk)
    {
        var stride = (long)_chunkSize + AttachmentCipher.TagSize;
        var cipherLength = chunk == _chunkCount - 1 ? _lastChunkCipherLength : (int)stride;
        return (AttachmentCipher.HeaderSize + chunk * stride, cipherLength);
    }

    private void DecryptBufferedChunk(long chunk, int cipherLength)
    {
        var plainLength = cipherLength - AttachmentCipher.TagSize;
        Span<byte> nonce = stackalloc byte[12];
        AttachmentCipher.WriteNonce(nonce, (uint)chunk, isFinal: chunk == _chunkCount - 1);

        _aes.Decrypt(
            nonce,
            _cipherBuffer.AsSpan(0, plainLength),
            _cipherBuffer.AsSpan(plainLength, AttachmentCipher.TagSize),
            _plainBuffer.AsSpan(0, plainLength),
            _associatedData);

        _bufferedChunk = chunk;
        _bufferedLength = plainLength;
    }

    private int CopyFromPlainBuffer(Span<byte> destination, long chunk)
    {
        var offsetInChunk = (int)(_position - chunk * _chunkSize);
        var count = Math.Min(destination.Length, _bufferedLength - offsetInChunk);
        _plainBuffer.AsSpan(offsetInChunk, count).CopyTo(destination);
        _position += count;
        return count;
    }
}
