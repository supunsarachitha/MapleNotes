using MapleNotes.Server.Features.Auth;

namespace MapleNotes.Server.Features.Passkeys;

/// <summary>A passkey of the signed-in account.</summary>
/// <param name="Id">The row's identifier.</param>
/// <param name="Name">The name the owner gave it.</param>
/// <param name="BackedUp">Whether it is synced to other devices (by a password manager or the platform).</param>
/// <param name="CreatedAtUtc">When it was added.</param>
/// <param name="LastUsedAtUtc">When it last signed in, if ever.</param>
public sealed record PasskeyResponse(Guid Id, string Name, bool BackedUp, DateTime CreatedAtUtc, DateTime? LastUsedAtUtc);

/// <summary>The relying party (this site) in creation options.</summary>
/// <param name="Id">The RP ID: the site's host name.</param>
/// <param name="Name">The app's name, shown by the authenticator.</param>
public sealed record RelyingParty(string Id, string Name);

/// <summary>The account in creation options.</summary>
/// <param name="Id">The user handle: the account's ID as 16 bytes.</param>
/// <param name="Name">The username.</param>
/// <param name="DisplayName">The display name.</param>
public sealed record PasskeyUser(byte[] Id, string Name, string DisplayName);

/// <summary>A credential the authenticator should exclude or allow.</summary>
/// <param name="Id">The credential ID.</param>
/// <param name="Transports">Transport hints, if known.</param>
public sealed record CredentialDescriptor(byte[] Id, IReadOnlyList<string>? Transports);

/// <summary>Options for <c>navigator.credentials.create()</c>, with binary fields as base64.</summary>
/// <param name="ChallengeId">The handle to send back with the new passkey.</param>
/// <param name="Challenge">The one-time challenge.</param>
/// <param name="Rp">This site.</param>
/// <param name="User">The account.</param>
/// <param name="Algorithms">COSE algorithms accepted, preferred first.</param>
/// <param name="ExcludeCredentials">The account's passkeys, so the same authenticator is not added twice.</param>
/// <param name="TimeoutMs">How long the browser should wait.</param>
public sealed record PasskeyCreationOptions(
    string ChallengeId, byte[] Challenge, RelyingParty Rp, PasskeyUser User, IReadOnlyList<int> Algorithms,
    IReadOnlyList<CredentialDescriptor> ExcludeCredentials, int TimeoutMs);

/// <summary>Options for <c>navigator.credentials.get()</c>. No credentials are listed: any passkey for the site may answer.</summary>
/// <param name="ChallengeId">The handle to send back with the answer.</param>
/// <param name="Challenge">The one-time challenge.</param>
/// <param name="RpId">The RP ID.</param>
/// <param name="TimeoutMs">How long the browser should wait.</param>
public sealed record PasskeyRequestOptions(string ChallengeId, byte[] Challenge, string RpId, int TimeoutMs);

/// <summary>A new passkey, as the browser created it.</summary>
/// <param name="Id">The credential ID (<c>rawId</c>).</param>
/// <param name="ClientDataJson">The client data JSON.</param>
/// <param name="AuthenticatorData">From <c>getAuthenticatorData()</c>.</param>
/// <param name="PublicKey">From <c>getPublicKey()</c>: a DER SubjectPublicKeyInfo.</param>
/// <param name="PublicKeyAlgorithm">From <c>getPublicKeyAlgorithm()</c>.</param>
/// <param name="Transports">From <c>getTransports()</c>.</param>
public sealed record NewPasskeyCredential(
    byte[] Id, byte[] ClientDataJson, byte[] AuthenticatorData, byte[] PublicKey, int PublicKeyAlgorithm,
    IReadOnlyList<string>? Transports = null);

/// <summary>Adds a passkey to the signed-in account.</summary>
/// <param name="Proof">Proof of the password.</param>
/// <param name="ChallengeId">The handle from the creation options.</param>
/// <param name="Name">A name for it, such as the device; a default is used when empty.</param>
/// <param name="Credential">The new passkey.</param>
public sealed record AddPasskeyRequest(CredentialProof Proof, string ChallengeId, string? Name, NewPasskeyCredential Credential);

/// <summary>Renames a passkey.</summary>
/// <param name="Name">The new name.</param>
public sealed record RenamePasskeyRequest(string Name);

/// <summary>Removes a passkey.</summary>
/// <param name="Proof">Proof of the password.</param>
public sealed record RemovePasskeyRequest(CredentialProof Proof);

/// <summary>A passkey's answer to a sign-in challenge.</summary>
/// <param name="Id">The credential ID (<c>rawId</c>).</param>
/// <param name="ClientDataJson">The client data JSON.</param>
/// <param name="AuthenticatorData">The authenticator data.</param>
/// <param name="Signature">The signature.</param>
/// <param name="UserHandle">The user handle the passkey stores (the account's ID).</param>
public sealed record PasskeyAssertion(byte[] Id, byte[] ClientDataJson, byte[] AuthenticatorData, byte[] Signature, byte[]? UserHandle);

/// <summary>Signs in with a passkey.</summary>
/// <param name="ChallengeId">The handle from the request options.</param>
/// <param name="Credential">The passkey's answer.</param>
/// <param name="RememberMe">Whether to keep the session after the browser closes.</param>
public sealed record PasskeyLoginRequest(string ChallengeId, PasskeyAssertion Credential, bool RememberMe = false);
