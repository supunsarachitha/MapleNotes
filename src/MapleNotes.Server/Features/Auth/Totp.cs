using System.Security.Cryptography;
using System.Text;

namespace MapleNotes.Server.Features.Auth;

/// <summary>
/// Time-based one-time passwords (RFC 6238) as authenticator apps make them: HMAC-SHA1, 30-second steps, 6 digits.
/// </summary>
/// <remarks>
/// These are the parameters every authenticator app supports; apps that are offered other ones in the setup link often
/// ignore them and show wrong codes, so the setup link names them only to be explicit.
/// </remarks>
public static class Totp
{
    /// <summary>Length of a new secret in bytes (160 bits, as RFC 4226 recommends).</summary>
    public const int SecretBytes = 20;

    /// <summary>Digits in a code.</summary>
    public const int Digits = 6;

    /// <summary>Seconds in a time step.</summary>
    public const int StepSeconds = 30;

    private const string Base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    /// <summary>The time step a moment falls in.</summary>
    /// <param name="now">The moment.</param>
    /// <returns>Whole steps since the Unix epoch.</returns>
    public static long StepAt(DateTimeOffset now) => now.ToUnixTimeSeconds() / StepSeconds;

    /// <summary>Computes the code of one time step (RFC 4226 §5.3).</summary>
    /// <param name="secret">The shared secret.</param>
    /// <param name="step">The time step.</param>
    /// <returns>The code, with leading zeros.</returns>
    public static string Code(ReadOnlySpan<byte> secret, long step)
    {
        Span<byte> counter = stackalloc byte[8];
        System.Buffers.Binary.BinaryPrimitives.WriteInt64BigEndian(counter, step);
        Span<byte> hash = stackalloc byte[HMACSHA1.HashSizeInBytes];
        HMACSHA1.HashData(secret, counter, hash);
        var offset = hash[^1] & 0x0F;
        var binary = ((hash[offset] & 0x7F) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
        return (binary % 1_000_000).ToString("D6", System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// Finds the step a code belongs to, allowing one step either side of <paramref name="now"/> for clocks that are
    /// slightly off and codes typed just as they change. Only steps after <paramref name="lastUsedStep"/> count.
    /// </summary>
    /// <param name="secret">The shared secret.</param>
    /// <param name="code">The code typed (spaces are ignored).</param>
    /// <param name="now">The current time.</param>
    /// <param name="lastUsedStep">The step of the last code accepted, which cannot be used again.</param>
    /// <returns>The matching step, or null.</returns>
    public static long? Match(ReadOnlySpan<byte> secret, string code, DateTimeOffset now, long lastUsedStep)
    {
        var digits = code.Replace(" ", "", StringComparison.Ordinal);
        if (digits.Length != Digits || !digits.All(char.IsAsciiDigit))
        {
            return null;
        }

        var current = StepAt(now);
        long? match = null;
        for (var step = current - 1; step <= current + 1; step++)
        {
            // Every candidate is compared, in constant time, so the time taken says nothing about which one matched.
            var equal = CryptographicOperations.FixedTimeEquals(
                Encoding.ASCII.GetBytes(Code(secret, step)), Encoding.ASCII.GetBytes(digits));
            if (equal && step > lastUsedStep && match is null)
            {
                match = step;
            }
        }

        return match;
    }

    /// <summary>Writes bytes in Base32 (RFC 4648) without padding, as authenticator apps expect secrets.</summary>
    /// <param name="data">The bytes.</param>
    /// <returns>Upper-case Base32 text.</returns>
    public static string ToBase32(ReadOnlySpan<byte> data)
    {
        var output = new StringBuilder((data.Length * 8 + 4) / 5);
        int buffer = 0, bits = 0;
        foreach (var b in data)
        {
            buffer = (buffer << 8) | b;
            bits += 8;
            while (bits >= 5)
            {
                output.Append(Base32Alphabet[(buffer >> (bits - 5)) & 31]);
                bits -= 5;
            }
        }

        if (bits > 0)
        {
            output.Append(Base32Alphabet[(buffer << (5 - bits)) & 31]);
        }

        return output.ToString();
    }

    /// <summary>Reads Base32 text, ignoring case, spaces and padding.</summary>
    /// <param name="text">The text.</param>
    /// <returns>The bytes, or null when the text is not Base32.</returns>
    public static byte[]? FromBase32(string? text)
    {
        if (text is null)
        {
            return null;
        }

        var output = new List<byte>(text.Length * 5 / 8);
        int buffer = 0, bits = 0;
        foreach (var c in text.ToUpperInvariant())
        {
            if (c is ' ' or '=')
            {
                continue;
            }

            var value = Base32Alphabet.IndexOf(c, StringComparison.Ordinal);
            if (value < 0)
            {
                return null;
            }

            buffer = (buffer << 5) | value;
            bits += 5;
            if (bits >= 8)
            {
                output.Add((byte)(buffer >> (bits - 8)));
                bits -= 8;
            }
        }

        return [.. output];
    }
}
