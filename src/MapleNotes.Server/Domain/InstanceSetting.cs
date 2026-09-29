namespace MapleNotes.Server.Domain;

/// <summary>An instance-wide setting that administrators can change at runtime (for example open registration).</summary>
public sealed class InstanceSetting
{
    /// <summary>Setting name; primary key.</summary>
    public required string Key { get; init; }

    /// <summary>Setting value as text.</summary>
    public required string Value { get; set; }
}
