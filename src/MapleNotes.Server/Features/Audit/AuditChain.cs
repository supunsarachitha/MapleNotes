using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using MapleNotes.Server.Domain;

namespace MapleNotes.Server.Features.Audit;

/// <summary>
/// The audit log's hash chain: each entry's hash is HMAC-SHA256(audit key, previous hash ‖ entry content), with the
/// audit key derived from the master key (see <c>KeyMaterial.AuditKey</c>).
/// </summary>
/// <remarks>
/// Someone who can change the database but does not hold the master key cannot compute a valid hash, so editing an
/// entry breaks its own link, and deleting one breaks the link of the entry after it. Removing the newest entries
/// leaves no gap in the chain; the copy written to standard output (<c>MAPLE_AUDIT_STDOUT</c>) covers that case.
/// Fields are written with a presence byte and a length prefix, so no two different entries encode alike.
/// </remarks>
public static class AuditChain
{
    /// <summary>Length of a hash.</summary>
    public const int HashLength = 32;

    /// <summary>What the first entry after the chain started links to.</summary>
    public static byte[] Genesis => new byte[HashLength];

    /// <summary>Computes an entry's hash.</summary>
    /// <param name="key">The audit key.</param>
    /// <param name="previous">The previous entry's hash (or the anchor's).</param>
    /// <param name="entry">The entry; its <c>Id</c> and <c>Hash</c> are not part of it.</param>
    /// <returns>The hash.</returns>
    public static byte[] HashEntry(ReadOnlySpan<byte> key, ReadOnlySpan<byte> previous, AuditEntry entry)
    {
        using var mac = IncrementalHash.CreateHMAC(HashAlgorithmName.SHA256, key);
        AppendText(mac, "maple-notes/v1/audit-entry");
        mac.AppendData(previous);
        AppendNumber(mac, entry.AtUtc.Ticks);
        AppendText(mac, entry.Event.ToString());
        AppendText(mac, entry.Username);
        AppendText(mac, entry.TargetUsername);
        AppendText(mac, entry.Method);
        AppendText(mac, entry.Detail);
        AppendText(mac, entry.IpAddress);
        return mac.GetHashAndReset();
    }

    /// <summary>Computes the anchor's MAC over its fields.</summary>
    /// <param name="key">The audit key.</param>
    /// <param name="anchor">The anchor.</param>
    /// <returns>The MAC.</returns>
    public static byte[] SealAnchor(ReadOnlySpan<byte> key, AuditChainAnchor anchor)
    {
        using var mac = IncrementalHash.CreateHMAC(HashAlgorithmName.SHA256, key);
        AppendText(mac, "maple-notes/v1/audit-anchor");
        AppendNumber(mac, anchor.LegacyThroughId);
        AppendNumber(mac, anchor.StartedAtUtc.Ticks);
        AppendNumber(mac, anchor.PrunedThroughId);
        mac.AppendData(anchor.Hash);
        AppendNumber(mac, anchor.PrunedAtUtc?.Ticks ?? -1);
        return mac.GetHashAndReset();
    }

    private static void AppendNumber(IncrementalHash mac, long value)
    {
        Span<byte> bytes = stackalloc byte[8];
        BinaryPrimitives.WriteInt64BigEndian(bytes, value);
        mac.AppendData(bytes);
    }

    private static void AppendText(IncrementalHash mac, string? text)
    {
        if (text is null)
        {
            mac.AppendData([0]);
            return;
        }

        var bytes = Encoding.UTF8.GetBytes(text);
        Span<byte> header = stackalloc byte[5];
        header[0] = 1;
        BinaryPrimitives.WriteInt32BigEndian(header[1..], bytes.Length);
        mac.AppendData(header);
        mac.AppendData(bytes);
    }
}

/// <summary>Writes audit entries to standard output as JSON lines when <c>MAPLE_AUDIT_STDOUT</c> is true.</summary>
public class AuditStdout
{
    /// <summary>Where the lines go; standard output unless a test swaps it.</summary>
    public virtual TextWriter Writer => Console.Out;
}
