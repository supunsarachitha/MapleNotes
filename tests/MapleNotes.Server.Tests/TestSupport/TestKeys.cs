using System.Security.Cryptography;
using MapleNotes.Server.Infrastructure.Crypto;

namespace MapleNotes.Server.Tests.TestSupport;

internal static class TestKeys
{
    public static byte[] NewMasterKey() => RandomNumberGenerator.GetBytes(MasterKey.SizeBytes);

    public static KeyMaterial NewKeyMaterial() => new(NewMasterKey());

    /// <summary>Returns a fresh <see cref="UserDataKey"/> over a copy of <paramref name="key"/> (disposal wipes the copy).</summary>
    public static UserDataKey DataKey(byte[] key, byte version = 1) => new(key.ToArray(), version);
}

/// <summary>A clock the test controls.</summary>
internal sealed class ManualTimeProvider(DateTimeOffset start) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = start;

    public override DateTimeOffset GetUtcNow() => Now;

    public void Advance(TimeSpan by) => Now += by;
}
