using MapleNotes.Server.Domain;

namespace MapleNotes.Server.Features.Admin;

/// <summary>Instance settings editable by administrators.</summary>
/// <param name="AllowRegistration">Whether visitors can create accounts.</param>
/// <param name="StorageQuotaMb">The most each account may store, notes and files together, in megabytes; null when
/// there is no limit.</param>
/// <param name="AppName">The name the app shows, if administrators chose one; null for "Maple Notes".</param>
/// <param name="SessionDays">How many days a session lasts after it was last used.</param>
/// <param name="DeviceNotebooks">Whether the installed app offers notebooks kept only on the device.</param>
public sealed record InstanceSettingsResponse(
    bool AllowRegistration, int? StorageQuotaMb, string? AppName = null, int SessionDays = 30, bool DeviceNotebooks = false);

/// <summary>Request to change instance settings. It replaces them all: a field left out takes its default.</summary>
/// <param name="AllowRegistration">Whether visitors can create accounts.</param>
/// <param name="StorageQuotaMb">The most each account may store, notes and files together, in megabytes (1 to
/// 16,777,216, which is 16 TB), or null for no limit. An account already over a new limit keeps its notes and files
/// but cannot add more until it is back under it.</param>
/// <param name="AppName">The name the app shows in its menu, sign-in page and browser tab (at most 40 characters, one
/// line), or null for "Maple Notes".</param>
/// <param name="SessionDays">How many days a session lasts after it was last used, 1 to 400 (null for 30). Using the
/// app renews it. New sign-ins get the new length; sessions already signed in keep theirs until they sign in again.</param>
/// <param name="DeviceNotebooks">Whether the installed app offers a notebook kept only on the device, which works without
/// this server and never syncs with it. Turning it off stops the app offering new ones; notebooks already on devices keep
/// opening there, since their notes exist nowhere else.</param>
public sealed record UpdateInstanceSettingsRequest(
    bool AllowRegistration, int? StorageQuotaMb = null, string? AppName = null, int? SessionDays = null, bool DeviceNotebooks = false);

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
