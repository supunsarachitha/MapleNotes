using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text.Json;

namespace MapleNotes.Server.Features.Passkeys;

/// <summary>
/// The checks of the WebAuthn Level 3 relying-party steps (§7.1 registration, §7.2 authentication) that apply to
/// passkeys without attestation, using only the .NET cryptography APIs.
/// </summary>
/// <remarks>
/// <para>
/// The browser sends the public key as a DER SubjectPublicKeyInfo (<c>AuthenticatorAttestationResponse.getPublicKey()</c>)
/// with its COSE algorithm, and the authenticator data from <c>getAuthenticatorData()</c>, so no CBOR is parsed. With
/// attestation <c>none</c> the key is taken on trust in either form; what is checked is that the authenticator data
/// belongs to this site (RP ID hash), that the user was present and verified, and that the client data carries this
/// server's one-time challenge, origin and ceremony type.
/// </para>
/// <para>Only ES256 (P-256) and RS256 keys of at least 2048 bits are accepted; every browser offers ES256.</para>
/// </remarks>
public static class WebAuthn
{
    /// <summary>COSE algorithm ECDSA with P-256 and SHA-256.</summary>
    public const int Es256 = -7;

    /// <summary>COSE algorithm RSASSA-PKCS1-v1_5 with SHA-256.</summary>
    public const int Rs256 = -257;

    /// <summary>The algorithms offered at registration, preferred first.</summary>
    public static IReadOnlyList<int> Algorithms { get; } = [Es256, Rs256];

    private const byte UserPresent = 0x01;
    private const byte UserVerified = 0x04;
    private const byte BackupEligible = 0x08;
    private const byte BackedUpFlag = 0x10;
    private const byte AttestedCredentialData = 0x40;

    /// <summary>The parsed fixed part of authenticator data.</summary>
    /// <param name="Flags">The flags byte.</param>
    /// <param name="SignCount">The signature counter.</param>
    /// <param name="CredentialId">The credential ID from attested credential data, when present.</param>
    public sealed record AuthenticatorData(byte Flags, uint SignCount, byte[]? CredentialId)
    {
        /// <summary>Gets whether the passkey is backed up (synced).</summary>
        public bool BackedUp => (Flags & BackedUpFlag) != 0;
    }

    /// <summary>Checks a new passkey and returns its credential ID, counter and backup state.</summary>
    /// <param name="ceremony">The challenge, RP ID and origin the server issued.</param>
    /// <param name="rawId">The credential ID the browser reported.</param>
    /// <param name="clientDataJson">The client data JSON bytes.</param>
    /// <param name="authenticatorData">The authenticator data bytes.</param>
    /// <param name="publicKey">The DER SubjectPublicKeyInfo.</param>
    /// <param name="algorithm">The COSE algorithm.</param>
    /// <returns>The parsed authenticator data.</returns>
    /// <exception cref="WebAuthnException">A check failed.</exception>
    public static AuthenticatorData VerifyRegistration(
        Ceremony ceremony, byte[] rawId, byte[] clientDataJson, byte[] authenticatorData, byte[] publicKey, int algorithm)
    {
        if (rawId.Length is 0 or > Domain.Passkey.MaxCredentialIdBytes)
        {
            throw new WebAuthnException("The passkey's ID is not valid.");
        }

        CheckClientData(clientDataJson, "webauthn.create", ceremony);
        var data = ParseAuthenticatorData(authenticatorData, ceremony.RpId);
        if ((data.Flags & AttestedCredentialData) == 0 || data.CredentialId is null
            || !CryptographicOperations.FixedTimeEquals(data.CredentialId, rawId))
        {
            throw new WebAuthnException("The passkey's data does not match its ID.");
        }

        using var _ = ImportKey(publicKey, algorithm); // proves the key is usable before it is stored
        return data;
    }

    /// <summary>Checks a sign-in signature from a stored passkey.</summary>
    /// <param name="ceremony">The challenge, RP ID and origin the server issued.</param>
    /// <param name="clientDataJson">The client data JSON bytes.</param>
    /// <param name="authenticatorData">The authenticator data bytes.</param>
    /// <param name="signature">The signature over the authenticator data and the hash of the client data.</param>
    /// <param name="publicKey">The stored DER SubjectPublicKeyInfo.</param>
    /// <param name="algorithm">The stored COSE algorithm.</param>
    /// <returns>The parsed authenticator data.</returns>
    /// <exception cref="WebAuthnException">A check failed.</exception>
    public static AuthenticatorData VerifyAssertion(
        Ceremony ceremony, byte[] clientDataJson, byte[] authenticatorData, byte[] signature, byte[] publicKey, int algorithm)
    {
        CheckClientData(clientDataJson, "webauthn.get", ceremony);
        var data = ParseAuthenticatorData(authenticatorData, ceremony.RpId);

        var signed = new byte[authenticatorData.Length + SHA256.HashSizeInBytes];
        authenticatorData.CopyTo(signed, 0);
        SHA256.HashData(clientDataJson, signed.AsSpan(authenticatorData.Length));

        using var key = ImportKey(publicKey, algorithm);
        var valid = key switch
        {
            ECDsa ec => ec.VerifyData(signed, signature, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence),
            RSA rsa => rsa.VerifyData(signed, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1),
            _ => false,
        };
        if (!valid)
        {
            throw new WebAuthnException("The passkey's signature is not valid.");
        }

        return data;
    }

    /// <summary>Parses authenticator data and checks the RP ID hash and the user-present and user-verified flags.</summary>
    /// <param name="bytes">The authenticator data.</param>
    /// <param name="rpId">The expected RP ID.</param>
    /// <returns>The parsed data.</returns>
    /// <exception cref="WebAuthnException">The data is malformed or for another site, or the user was not verified.</exception>
    public static AuthenticatorData ParseAuthenticatorData(byte[] bytes, string rpId)
    {
        if (bytes.Length < 37)
        {
            throw new WebAuthnException("The passkey's data is too short.");
        }

        var expectedHash = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(rpId));
        if (!CryptographicOperations.FixedTimeEquals(bytes.AsSpan(0, 32), expectedHash))
        {
            throw new WebAuthnException("The passkey belongs to another site.");
        }

        var flags = bytes[32];
        if ((flags & UserPresent) == 0 || (flags & UserVerified) == 0)
        {
            throw new WebAuthnException("The passkey did not confirm it was you (fingerprint, face or PIN).");
        }

        if ((flags & BackedUpFlag) != 0 && (flags & BackupEligible) == 0)
        {
            throw new WebAuthnException("The passkey's data is not valid.");
        }

        var signCount = BinaryPrimitives.ReadUInt32BigEndian(bytes.AsSpan(33, 4));
        byte[]? credentialId = null;
        if ((flags & AttestedCredentialData) != 0)
        {
            // AAGUID (16 bytes), credential ID length (2 bytes, big-endian), credential ID, then the COSE key.
            if (bytes.Length < 55)
            {
                throw new WebAuthnException("The passkey's data is too short.");
            }

            var length = BinaryPrimitives.ReadUInt16BigEndian(bytes.AsSpan(53, 2));
            if (length is 0 or > Domain.Passkey.MaxCredentialIdBytes || bytes.Length < 55 + length)
            {
                throw new WebAuthnException("The passkey's ID is not valid.");
            }

            credentialId = bytes.AsSpan(55, length).ToArray();
        }

        return new AuthenticatorData(flags, signCount, credentialId);
    }

    /// <summary>Checks a passkey's counter against the stored one (WebAuthn §7.2 step 22).</summary>
    /// <param name="stored">The stored counter.</param>
    /// <param name="reported">The counter in this signature.</param>
    /// <returns>False when both are used and the new one did not go up, which suggests a cloned authenticator.</returns>
    public static bool CounterAdvanced(long stored, uint reported) => (stored == 0 && reported == 0) || reported > stored;

    private static void CheckClientData(byte[] clientDataJson, string type, Ceremony ceremony)
    {
        string? actualType, challenge, origin;
        bool crossOrigin;
        try
        {
            using var document = JsonDocument.Parse(clientDataJson);
            var root = document.RootElement;
            actualType = root.GetProperty("type").GetString();
            challenge = root.GetProperty("challenge").GetString();
            origin = root.GetProperty("origin").GetString();
            crossOrigin = root.TryGetProperty("crossOrigin", out var cross) && cross.ValueKind == JsonValueKind.True;
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException)
        {
            throw new WebAuthnException("The browser's passkey data is not valid.");
        }

        if (actualType != type)
        {
            throw new WebAuthnException("The browser's passkey data is for another step.");
        }

        var expected = System.Text.Encoding.ASCII.GetBytes(Base64Url(ceremony.Challenge));
        if (challenge is null || !CryptographicOperations.FixedTimeEquals(System.Text.Encoding.ASCII.GetBytes(challenge), expected))
        {
            throw new WebAuthnException("The passkey request has expired. Try again.");
        }

        if (!string.Equals(origin, ceremony.Origin, StringComparison.Ordinal) || crossOrigin)
        {
            throw new WebAuthnException("The passkey was used on another site.");
        }
    }

    private static AsymmetricAlgorithm ImportKey(byte[] publicKey, int algorithm)
    {
        try
        {
            switch (algorithm)
            {
                case Es256:
                    var ec = ECDsa.Create();
                    ec.ImportSubjectPublicKeyInfo(publicKey, out var ecRead);
                    if (ecRead != publicKey.Length || ec.ExportParameters(false).Curve.Oid.Value != ECCurve.NamedCurves.nistP256.Oid.Value)
                    {
                        ec.Dispose();
                        break;
                    }

                    return ec;
                case Rs256:
                    var rsa = RSA.Create();
                    rsa.ImportSubjectPublicKeyInfo(publicKey, out var rsaRead);
                    if (rsaRead != publicKey.Length || rsa.KeySize < 2048)
                    {
                        rsa.Dispose();
                        break;
                    }

                    return rsa;
            }
        }
        catch (CryptographicException)
        {
        }

        throw new WebAuthnException("This kind of passkey is not supported. Try another device or password manager.");
    }

    /// <summary>Encodes bytes as base64url without padding, as WebAuthn does.</summary>
    /// <param name="bytes">The bytes.</param>
    /// <returns>The text.</returns>
    public static string Base64Url(ReadOnlySpan<byte> bytes) => System.Buffers.Text.Base64Url.EncodeToString(bytes);
}

/// <summary>What the server issued for one passkey request: the challenge and where it may be answered.</summary>
/// <param name="Challenge">32 random bytes.</param>
/// <param name="RpId">The relying-party ID (the site's host name).</param>
/// <param name="Origin">The origin the browser must report.</param>
public sealed record Ceremony(byte[] Challenge, string RpId, string Origin);

/// <summary>A passkey check failed; the message is safe to show.</summary>
/// <param name="message">What went wrong.</param>
public sealed class WebAuthnException(string message) : Exception(message);
