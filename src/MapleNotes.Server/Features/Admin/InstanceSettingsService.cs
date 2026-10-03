using System.Globalization;
using System.Security.Cryptography;
using MapleNotes.Server.Domain;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace MapleNotes.Server.Features.Admin;

/// <summary>
/// Instance-wide settings that administrators can change at runtime. Values saved in the database take precedence
/// over the environment defaults in <see cref="MapleOptions"/>.
/// </summary>
/// <param name="db">Database context.</param>
/// <param name="options">Environment defaults.</param>
public sealed class InstanceSettingsService(MapleDbContext db, MapleOptions options)
{
    /// <summary>Database key of the "open registration" setting.</summary>
    public const string AllowRegistrationKey = "AllowRegistration";

    /// <summary>Database key of the storage limit per account, in megabytes; absent when there is none.</summary>
    public const string StorageQuotaKey = "StorageQuotaMb";

    /// <summary>The largest storage limit per account an administrator can set, in megabytes (16 TB).</summary>
    public const int MaxStorageQuotaMb = 16 * 1024 * 1024;

    /// <summary>The app's name when administrators have not chosen another.</summary>
    public const string DefaultAppName = "Maple Notes";

    /// <summary>The longest app name, in characters.</summary>
    public const int MaxAppNameLength = 40;

    /// <summary>The largest custom icon, in bytes.</summary>
    public const int MaxIconBytes = 256 * 1024;

    private const string AppNameKey = "AppName";
    private const string IconKey = "AppIcon";
    private const string IconTypeKey = "AppIconType";
    private const string IconVersionKey = "AppIconVersion";

    /// <summary>Returns whether visitors may create accounts.</summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>True when registration is open.</returns>
    public async Task<bool> IsRegistrationOpenAsync(CancellationToken cancellationToken)
    {
        var setting = await FindAsync(AllowRegistrationKey, cancellationToken);
        return setting is null ? options.AllowRegistration : bool.Parse(setting.Value);
    }

    /// <summary>Returns the most each account may store, notes and files together.</summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The limit in megabytes, or null when there is none.</returns>
    public async Task<int?> GetStorageQuotaMbAsync(CancellationToken cancellationToken)
    {
        var setting = await FindAsync(StorageQuotaKey, cancellationToken);
        return setting is null ? null : int.Parse(setting.Value, CultureInfo.InvariantCulture);
    }

    /// <summary>Returns the name administrators gave the app.</summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The name, or null for the default (<see cref="DefaultAppName"/>).</returns>
    public async Task<string?> GetAppNameAsync(CancellationToken cancellationToken) =>
        (await FindAsync(AppNameKey, cancellationToken))?.Value;

    /// <summary>Tidies an app name: trimmed, and null (the default) when empty.</summary>
    /// <param name="name">The name as entered.</param>
    /// <param name="normalized">The name to save, or null for the default.</param>
    /// <returns>False when it is longer than <see cref="MaxAppNameLength"/> or has control characters.</returns>
    public static bool TryNormalizeAppName(string? name, out string? normalized)
    {
        var trimmed = name?.Trim();
        normalized = string.IsNullOrEmpty(trimmed) ? null : trimmed;
        return normalized is null || (normalized.Length <= MaxAppNameLength && !normalized.Any(char.IsControl));
    }

    /// <summary>Saves the settings.</summary>
    /// <param name="allowRegistration">True to let visitors create accounts.</param>
    /// <param name="storageQuotaMb">The storage limit per account in megabytes, or null for none.</param>
    /// <param name="appName">The app's name (see <see cref="TryNormalizeAppName"/>), or null for the default.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>A task that completes when the settings are saved.</returns>
    public async Task SaveAsync(bool allowRegistration, int? storageQuotaMb, string? appName, CancellationToken cancellationToken)
    {
        await SetAsync(AllowRegistrationKey, allowRegistration.ToString(), cancellationToken);
        await SetAsync(StorageQuotaKey, storageQuotaMb?.ToString(CultureInfo.InvariantCulture), cancellationToken);
        await SetAsync(AppNameKey, appName, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>Returns the version of the custom icon, which changes with its content.</summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The version, or null when the app uses its own icon.</returns>
    public async Task<string?> GetIconVersionAsync(CancellationToken cancellationToken) =>
        (await FindAsync(IconVersionKey, cancellationToken))?.Value;

    /// <summary>Returns the custom icon.</summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>Its bytes, content type and version, or null when the app uses its own icon.</returns>
    public async Task<(byte[] Content, string ContentType, string Version)?> GetIconAsync(CancellationToken cancellationToken)
    {
        var settings = await db.InstanceSettings.AsNoTracking()
            .Where(s => s.Key == IconKey || s.Key == IconTypeKey || s.Key == IconVersionKey)
            .ToDictionaryAsync(s => s.Key, s => s.Value, cancellationToken);
        return settings.TryGetValue(IconKey, out var icon) && settings.TryGetValue(IconTypeKey, out var type)
            && settings.TryGetValue(IconVersionKey, out var version)
            ? (Convert.FromBase64String(icon), type, version)
            : null;
    }

    /// <summary>Recognises a PNG, JPEG or WebP image by its first bytes; nothing else can be an icon.</summary>
    /// <param name="content">The file.</param>
    /// <returns>Its content type, or null when it is none of those.</returns>
    public static string? DetectIconType(ReadOnlySpan<byte> content)
    {
        if (content.StartsWith((ReadOnlySpan<byte>)[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
        {
            return "image/png";
        }

        if (content.StartsWith((ReadOnlySpan<byte>)[0xFF, 0xD8, 0xFF]))
        {
            return "image/jpeg";
        }

        return content.Length >= 12 && content[..4].SequenceEqual("RIFF"u8) && content[8..12].SequenceEqual("WEBP"u8) ? "image/webp" : null;
    }

    /// <summary>Reads an image's size from its header, without decoding it.</summary>
    /// <param name="content">A PNG, JPEG or WebP image.</param>
    /// <returns>Its width and height in pixels, or null when the header cannot be read.</returns>
    public static (int Width, int Height)? ReadImageSize(ReadOnlySpan<byte> content)
    {
        static int BigEndian16(ReadOnlySpan<byte> b, int at) => (b[at] << 8) | b[at + 1];
        static int LittleEndian24(ReadOnlySpan<byte> b, int at) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);

        switch (DetectIconType(content))
        {
            case "image/png" when content.Length >= 24 && content[12..16].SequenceEqual("IHDR"u8):
                return (System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(content[16..]),
                    System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(content[20..]));
            case "image/jpeg":
                // Walk the segments to the frame header (SOF0–SOF15, except DHT, JPG and DAC), which holds the size.
                for (var at = 2; at + 9 <= content.Length && content[at] == 0xFF;)
                {
                    var marker = content[at + 1];
                    if (marker is >= 0xC0 and <= 0xCF and not (0xC4 or 0xC8 or 0xCC))
                    {
                        return (BigEndian16(content, at + 7), BigEndian16(content, at + 5));
                    }

                    at += 2 + BigEndian16(content, at + 2);
                }

                return null;
            case "image/webp" when content.Length >= 30:
                if (content[12..16].SequenceEqual("VP8X"u8))
                {
                    return (1 + LittleEndian24(content, 24), 1 + LittleEndian24(content, 27));
                }

                if (content[12..16].SequenceEqual("VP8L"u8))
                {
                    return (1 + (content[21] | ((content[22] & 0x3F) << 8)),
                        1 + ((content[22] >> 6) | (content[23] << 2) | ((content[24] & 0x0F) << 10)));
                }

                return content[12..16].SequenceEqual("VP8 "u8)
                    ? ((content[26] | (content[27] << 8)) & 0x3FFF, (content[28] | (content[29] << 8)) & 0x3FFF)
                    : null;
            default:
                return null;
        }
    }

    /// <summary>Replaces the app's icon.</summary>
    /// <param name="content">A PNG, JPEG or WebP image, at most <see cref="MaxIconBytes"/>.</param>
    /// <param name="contentType">Its type, from <see cref="DetectIconType"/>.</param>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>The new icon's version.</returns>
    public async Task<string> SetIconAsync(byte[] content, string contentType, CancellationToken cancellationToken)
    {
        var version = Convert.ToHexStringLower(SHA256.HashData(content))[..16];
        await SetAsync(IconKey, Convert.ToBase64String(content), cancellationToken);
        await SetAsync(IconTypeKey, contentType, cancellationToken);
        await SetAsync(IconVersionKey, version, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return version;
    }

    /// <summary>Goes back to the app's own icon.</summary>
    /// <param name="cancellationToken">Cancels the operation.</param>
    /// <returns>A task that completes when the custom icon is gone.</returns>
    public async Task RemoveIconAsync(CancellationToken cancellationToken)
    {
        await SetAsync(IconKey, null, cancellationToken);
        await SetAsync(IconTypeKey, null, cancellationToken);
        await SetAsync(IconVersionKey, null, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
    }

    private Task<InstanceSetting?> FindAsync(string key, CancellationToken cancellationToken) =>
        db.InstanceSettings.AsNoTracking().SingleOrDefaultAsync(s => s.Key == key, cancellationToken);

    private async Task SetAsync(string key, string? value, CancellationToken cancellationToken)
    {
        var setting = await db.InstanceSettings.SingleOrDefaultAsync(s => s.Key == key, cancellationToken);
        if (value is null)
        {
            if (setting is not null)
            {
                db.InstanceSettings.Remove(setting);
            }
        }
        else if (setting is null)
        {
            db.InstanceSettings.Add(new InstanceSetting { Key = key, Value = value });
        }
        else
        {
            setting.Value = value;
        }
    }
}
