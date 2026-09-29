using System.Globalization;
using System.Net;

namespace MapleNotes.Server.Infrastructure.Configuration;

/// <summary>
/// Instance-wide settings, read once at startup from <c>MAPLE_*</c> configuration keys (normally environment
/// variables; <c>appsettings.json</c> and command-line arguments with the same keys also work).
/// </summary>
/// <remarks>
/// The master key is deliberately not part of this type, so it can never be logged or serialized along with the
/// rest of the settings. See <see cref="Crypto.MasterKey"/>.
/// </remarks>
public sealed class MapleOptions
{
    /// <summary>Configuration key for <see cref="DataDirectory"/>.</summary>
    public const string DataDirectoryKey = "MAPLE_DATA_DIR";

    /// <summary>Configuration key for <see cref="AllowRegistration"/>.</summary>
    public const string AllowRegistrationKey = "MAPLE_ALLOW_REGISTRATION";

    /// <summary>Configuration key for <see cref="MaxUploadMegabytes"/>.</summary>
    public const string MaxUploadMegabytesKey = "MAPLE_MAX_UPLOAD_MB";

    /// <summary>Configuration key for <see cref="DefaultEncryption"/>.</summary>
    public const string DefaultEncryptionKey = "MAPLE_DEFAULT_ENCRYPTION";

    /// <summary>Configuration key for <see cref="TrustedProxies"/>.</summary>
    public const string TrustedProxiesKey = "MAPLE_TRUSTED_PROXIES";

    /// <summary>Configuration key for <see cref="AuthenticationRateLimit"/>.</summary>
    public const string AuthenticationRateLimitKey = "MAPLE_AUTH_RATE_LIMIT";

    /// <summary>
    /// Configuration key that, when <c>true</c>, publishes the OpenAPI document (<c>/openapi/v1.json</c>) and the
    /// interactive API reference (<c>/scalar</c>) outside Development. Read directly when the pipeline is built.
    /// </summary>
    public const string ApiDocsKey = "MAPLE_API_DOCS";

    /// <summary>
    /// Environment variable that allows link previews on this server (default true). Each account still has to turn
    /// them on; set it to false to keep the server from fetching any links.
    /// </summary>
    public const string LinkPreviewsKey = "MAPLE_LINK_PREVIEWS";

    /// <summary>Absolute path of the directory holding the database, attachments, key ring and backups.</summary>
    public required string DataDirectory { get; init; }

    /// <summary>
    /// Whether visitors may create accounts. The first account can always be created (it becomes the administrator);
    /// this value is the initial setting, which administrators can later change in the app.
    /// </summary>
    public bool AllowRegistration { get; init; }

    /// <summary>Maximum size of a single uploaded attachment, in megabytes.</summary>
    public int MaxUploadMegabytes { get; init; } = 25;

    /// <summary>Whether encryption at rest is switched on for newly created accounts.</summary>
    public bool DefaultEncryption { get; init; } = true;

    /// <summary>
    /// Reverse proxies (addresses or CIDR ranges) whose <c>X-Forwarded-*</c> headers are trusted. Empty means the
    /// headers are ignored, which is correct when the container is reached directly.
    /// </summary>
    public IReadOnlyList<IPNetwork> TrustedProxies { get; init; } = [];

    /// <summary>Sign-in, registration and password-change attempts allowed per client IP address per minute.</summary>
    public int AuthenticationRateLimit { get; init; } = 10;

    /// <summary>Whether accounts may turn on link previews, which make the server fetch the pages linked from notes.</summary>
    public bool LinkPreviews { get; init; } = true;

    /// <summary>Path of the encrypted SQLite database file.</summary>
    public string DatabasePath => Path.Combine(DataDirectory, "maple.db");

    /// <summary>Directory holding attachment files.</summary>
    public string AttachmentsDirectory => Path.Combine(DataDirectory, "attachments");

    /// <summary>Directory holding the (encrypted) ASP.NET Core Data Protection key ring.</summary>
    public string KeysDirectory => Path.Combine(DataDirectory, "keys");

    /// <summary>Directory holding automatic database backups taken before schema migrations.</summary>
    public string BackupsDirectory => Path.Combine(DataDirectory, "backups");

    /// <summary><see cref="MaxUploadMegabytes"/> expressed in bytes.</summary>
    public long MaxUploadBytes => MaxUploadMegabytes * 1024L * 1024L;

    /// <summary>
    /// Reads and validates the settings.
    /// </summary>
    /// <param name="configuration">Application configuration.</param>
    /// <param name="contentRootPath">Base directory for resolving a relative <c>MAPLE_DATA_DIR</c>.</param>
    /// <returns>The validated settings.</returns>
    /// <exception cref="MapleStartupException">A value is present but invalid.</exception>
    public static MapleOptions FromConfiguration(IConfiguration configuration, string contentRootPath)
    {
        var dataDirectory = configuration[DataDirectoryKey];
        dataDirectory = string.IsNullOrWhiteSpace(dataDirectory) ? "data" : dataDirectory.Trim();

        return new MapleOptions
        {
            DataDirectory = Path.GetFullPath(dataDirectory, contentRootPath),
            AllowRegistration = ReadBoolean(configuration, AllowRegistrationKey, defaultValue: false),
            MaxUploadMegabytes = ReadInteger(configuration, MaxUploadMegabytesKey, defaultValue: 25, min: 1, max: 2048),
            DefaultEncryption = ReadBoolean(configuration, DefaultEncryptionKey, defaultValue: true),
            TrustedProxies = ReadNetworks(configuration, TrustedProxiesKey),
            AuthenticationRateLimit = ReadInteger(configuration, AuthenticationRateLimitKey, defaultValue: 10, min: 1, max: 10_000),
            LinkPreviews = ReadBoolean(configuration, LinkPreviewsKey, defaultValue: true),
        };
    }

    /// <summary>
    /// Creates the data directory layout if needed and verifies the process can write to it.
    /// </summary>
    /// <exception cref="MapleStartupException">A directory cannot be created or written to.</exception>
    public void EnsureDirectories()
    {
        foreach (var directory in new[] { DataDirectory, AttachmentsDirectory, KeysDirectory, BackupsDirectory })
        {
            try
            {
                Directory.CreateDirectory(directory);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                throw new MapleStartupException(
                    $"Cannot create directory '{directory}'. Check that {DataDirectoryKey} points to a writable location " +
                    "(in Docker, the volume mounted at /app/data must be writable by UID 1654).", ex);
            }
        }

        var probe = Path.Combine(DataDirectory, $".write-test-{Guid.NewGuid():N}");
        try
        {
            File.WriteAllBytes(probe, []);
            File.Delete(probe);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new MapleStartupException(
                $"The data directory '{DataDirectory}' is not writable. In Docker, make sure the volume mounted at " +
                "/app/data is writable by UID 1654 (for a bind mount: sudo chown -R 1654:1654 <host-dir>).", ex);
        }
    }

    private static bool ReadBoolean(IConfiguration configuration, string key, bool defaultValue)
    {
        var raw = configuration[key]?.Trim();
        if (string.IsNullOrEmpty(raw))
        {
            return defaultValue;
        }

        return raw.ToUpperInvariant() switch
        {
            "TRUE" or "1" or "YES" or "ON" => true,
            "FALSE" or "0" or "NO" or "OFF" => false,
            _ => throw new MapleStartupException($"{key} must be true or false (got '{raw}')."),
        };
    }

    private static int ReadInteger(IConfiguration configuration, string key, int defaultValue, int min, int max)
    {
        var raw = configuration[key]?.Trim();
        if (string.IsNullOrEmpty(raw))
        {
            return defaultValue;
        }

        if (!int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) || value < min || value > max)
        {
            throw new MapleStartupException($"{key} must be a whole number between {min} and {max} (got '{raw}').");
        }

        return value;
    }

    private static IPNetwork[] ReadNetworks(IConfiguration configuration, string key)
    {
        var raw = configuration[key];
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        var networks = new List<IPNetwork>();
        foreach (var entry in raw.Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (IPNetwork.TryParse(entry, out var network))
            {
                networks.Add(network);
            }
            else if (IPAddress.TryParse(entry, out var address))
            {
                networks.Add(new IPNetwork(address, address.GetAddressBytes().Length * 8));
            }
            else
            {
                throw new MapleStartupException(
                    $"{key} contains '{entry}', which is not an IP address or CIDR range (example: 172.18.0.0/16).");
            }
        }

        return [.. networks];
    }
}
