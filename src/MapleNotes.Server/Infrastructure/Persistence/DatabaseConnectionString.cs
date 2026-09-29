namespace MapleNotes.Server.Infrastructure.Persistence;

/// <summary>
/// Holds the database connection string, which contains the database key. <see cref="ToString"/> is redacted so the
/// value cannot end up in logs by accident.
/// </summary>
/// <param name="value">The connection string built by <see cref="SqlCipherConnectionString"/>.</param>
internal sealed class DatabaseConnectionString(string value)
{
    /// <summary>The connection string. Secret: never log it.</summary>
    public string Value { get; } = value;

    /// <inheritdoc />
    public override string ToString() => "[redacted database connection string]";
}
