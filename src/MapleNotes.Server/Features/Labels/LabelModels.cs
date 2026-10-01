namespace MapleNotes.Server.Features.Labels;

/// <summary>A label and how many active notes carry it.</summary>
/// <param name="Id">Label ID; filter notes with <c>GET /api/v1/notes?label={id}</c>.</param>
/// <param name="Name">The name; null for an end-to-end label.</param>
/// <param name="EncryptedName">The name of an end-to-end label, encrypted by the browser (base64).</param>
/// <param name="Color">The colour, one of Grey, Red, Orange, Amber, Green, Teal, Blue, Indigo, Purple and Pink.</param>
/// <param name="NoteCount">Active notes (neither archived nor in the trash) of the requested kinds with the label.</param>
public sealed record LabelResponse(Guid Id, string? Name, byte[]? EncryptedName, string Color, int NoteCount);

/// <summary>Request to create a label.</summary>
/// <remarks>
/// Accounts in end-to-end mode send <paramref name="Id"/> and <paramref name="EncryptedName"/> instead of
/// <paramref name="Name"/>; all other accounts send the name as it is.
/// </remarks>
/// <param name="Name">The name, 1–40 characters.</param>
/// <param name="Color">The colour; default Grey.</param>
/// <param name="Id">For an end-to-end label: the ID the browser chose and bound into the encrypted name (UUID version 7).</param>
/// <param name="EncryptedName">For an end-to-end label: the name, encrypted by the browser.</param>
public sealed record CreateLabelRequest(string? Name = null, string? Color = null, Guid? Id = null, byte[]? EncryptedName = null);

/// <summary>Request to rename or recolour a label. Omitted fields are unchanged.</summary>
/// <param name="Name">The new name (accounts without end-to-end encryption).</param>
/// <param name="EncryptedName">The new name, encrypted by the browser (end-to-end accounts).</param>
/// <param name="Color">The new colour.</param>
public sealed record UpdateLabelRequest(string? Name = null, byte[]? EncryptedName = null, string? Color = null);
