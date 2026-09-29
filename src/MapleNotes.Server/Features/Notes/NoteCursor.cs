using System.Buffers.Text;
using System.Globalization;
using System.Text;

namespace MapleNotes.Server.Features.Notes;

/// <summary>
/// Opaque position in a note feed: the creation time and ID of the last note on the previous page.
/// </summary>
/// <remarks>
/// Keyset ("seek") pagination: the next page is <c>WHERE (CreatedAtUtc, Id) &lt; (cursor)</c> in feed order. Unlike
/// offset paging, a note posted while the user scrolls never shifts the pages, so nothing is shown twice or skipped.
/// </remarks>
/// <param name="CreatedAtUtc">Creation time of the last note shown.</param>
/// <param name="Id">ID of the last note shown (breaks ties between identical timestamps).</param>
public readonly record struct NoteCursor(DateTime CreatedAtUtc, Guid Id)
{
    /// <summary>Encodes the cursor as a URL-safe string.</summary>
    /// <returns>The encoded cursor.</returns>
    public string Encode() =>
        Base64Url.EncodeToString(Encoding.UTF8.GetBytes(
            string.Create(CultureInfo.InvariantCulture, $"{CreatedAtUtc.Ticks}.{Id:N}")));

    /// <summary>Parses a cursor produced by <see cref="Encode"/>.</summary>
    /// <param name="value">The encoded cursor.</param>
    /// <param name="cursor">The parsed cursor.</param>
    /// <returns>True when the value is a valid cursor.</returns>
    public static bool TryParse(string? value, out NoteCursor cursor)
    {
        cursor = default;
        if (string.IsNullOrEmpty(value) || value.Length > 128)
        {
            return false;
        }

        try
        {
            var parts = Encoding.UTF8.GetString(Base64Url.DecodeFromChars(value)).Split('.');
            if (parts.Length == 2
                && long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var ticks)
                && ticks is >= 0 and <= 3155378975999999999 // DateTime.MaxValue.Ticks
                && Guid.TryParseExact(parts[1], "N", out var id))
            {
                cursor = new NoteCursor(new DateTime(ticks, DateTimeKind.Utc), id);
                return true;
            }
        }
        catch (FormatException)
        {
        }

        return false;
    }
}
