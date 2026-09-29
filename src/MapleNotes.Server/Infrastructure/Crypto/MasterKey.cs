using System.Security.Cryptography;
using MapleNotes.Server.Infrastructure.Configuration;

namespace MapleNotes.Server.Infrastructure.Crypto;

/// <summary>
/// Loads, validates and generates the instance master key: the single root secret from which every other
/// encryption key is derived (see <see cref="KeyMaterial"/>).
/// </summary>
/// <remarks>
/// The key is a random 256-bit value encoded as base64. It is supplied either directly in <c>MAPLE_MASTER_KEY</c> or
/// through a file named by <c>MAPLE_MASTER_KEY_FILE</c> (for Docker secrets). It is never written to the data
/// directory, so a copy of the data volume or a backup is useless without it; conversely, losing the key means
/// losing the data.
/// </remarks>
internal static class MasterKey
{
    /// <summary>Configuration key holding the base64 master key.</summary>
    public const string ValueKey = "MAPLE_MASTER_KEY";

    /// <summary>Configuration key holding the path of a file that contains the base64 master key.</summary>
    public const string FileKey = "MAPLE_MASTER_KEY_FILE";

    /// <summary>Master key length in bytes (256 bits).</summary>
    public const int SizeBytes = 32;

    private const string GenerateHint =
        "Generate one with `openssl rand -base64 32` or `docker run --rm maple-notes generate-key`.";

    /// <summary>
    /// Reads the master key from configuration.
    /// </summary>
    /// <param name="configuration">Application configuration.</param>
    /// <returns>The 32 key bytes. The caller owns the array and should wipe it once keys are derived.</returns>
    /// <exception cref="MapleStartupException">The key is missing, set twice, unreadable or malformed.</exception>
    public static byte[] Load(IConfiguration configuration)
    {
        var inline = configuration[ValueKey];
        var file = configuration[FileKey];
        var hasInline = !string.IsNullOrWhiteSpace(inline);
        var hasFile = !string.IsNullOrWhiteSpace(file);

        if (hasInline && hasFile)
        {
            throw new MapleStartupException($"Set either {ValueKey} or {FileKey}, not both.");
        }

        if (!hasInline && !hasFile)
        {
            throw new MapleStartupException($"{ValueKey} is not set. It is required to encrypt your data. {GenerateHint}");
        }

        if (hasInline)
        {
            return Parse(inline!, ValueKey);
        }

        string contents;
        try
        {
            contents = File.ReadAllText(file!.Trim());
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new MapleStartupException($"Cannot read the master key file '{file}' named by {FileKey}: {ex.Message}", ex);
        }

        return Parse(contents, FileKey);
    }

    /// <summary>
    /// Decodes and validates a base64 master key.
    /// </summary>
    /// <param name="encoded">The base64 text; surrounding whitespace is ignored.</param>
    /// <param name="source">Where the value came from, used in error messages.</param>
    /// <returns>The 32 key bytes.</returns>
    /// <exception cref="MapleStartupException">The value is not base64 or does not decode to 32 bytes.</exception>
    public static byte[] Parse(string encoded, string source = ValueKey)
    {
        byte[] key;
        try
        {
            key = Convert.FromBase64String(encoded.Trim());
        }
        catch (FormatException ex)
        {
            throw new MapleStartupException($"{source} is not valid base64. {GenerateHint}", ex);
        }

        if (key.Length != SizeBytes)
        {
            var length = key.Length;
            CryptographicOperations.ZeroMemory(key);
            throw new MapleStartupException(
                $"{source} must decode to {SizeBytes} bytes (256 bits), but it decodes to {length} bytes. {GenerateHint}");
        }

        return key;
    }

    /// <summary>Creates a new random master key.</summary>
    /// <returns>The key encoded as base64, ready to paste into <c>MAPLE_MASTER_KEY</c>.</returns>
    public static string Generate()
    {
        var key = RandomNumberGenerator.GetBytes(SizeBytes);
        try
        {
            return Convert.ToBase64String(key);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
        }
    }
}
