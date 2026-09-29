using MapleNotes.Server.Domain;

namespace MapleNotes.Server.Features.Admin;

/// <summary>Instance settings editable by administrators.</summary>
/// <param name="AllowRegistration">Whether visitors can create accounts.</param>
public sealed record InstanceSettingsResponse(bool AllowRegistration);

/// <summary>Request to change instance settings.</summary>
/// <param name="AllowRegistration">Whether visitors can create accounts.</param>
public sealed record UpdateInstanceSettingsRequest(bool AllowRegistration);

/// <summary>An account as seen by an administrator.</summary>
/// <param name="Id">Account ID.</param>
/// <param name="Username">Login name.</param>
/// <param name="DisplayName">Display name.</param>
/// <param name="Role">Role.</param>
/// <param name="IsDisabled">Whether sign-in is blocked.</param>
/// <param name="NoteCount">Number of notes (content is never shown to administrators).</param>
/// <param name="CreatedAtUtc">When the account was created.</param>
public sealed record AdminUserResponse(
    Guid Id, string Username, string DisplayName, UserRole Role, bool IsDisabled, int NoteCount, DateTime CreatedAtUtc);

/// <summary>Changes an administrator can make to another account. Omitted fields are left unchanged.</summary>
/// <param name="IsDisabled">Block or allow sign-in. Disabling signs the user out everywhere.</param>
/// <param name="Role">New role.</param>
public sealed record UpdateUserRequest(bool? IsDisabled = null, UserRole? Role = null);
