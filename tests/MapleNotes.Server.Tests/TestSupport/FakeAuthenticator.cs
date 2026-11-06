using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MapleNotes.Server.Features.Passkeys;

namespace MapleNotes.Server.Tests.TestSupport;

/// <summary>
/// A software passkey that answers WebAuthn requests the way a browser and authenticator do: it builds the client data
/// JSON and authenticator data and signs them with its own key.
/// </summary>
internal sealed class FakeAuthenticator : IDisposable
{
    private const byte Up = 0x01, Uv = 0x04, Be = 0x08, Bs = 0x10, At = 0x40;

    private readonly AsymmetricAlgorithm _key;

    public FakeAuthenticator(int algorithm = WebAuthn.Es256, ECCurve? curve = null)
    {
        Algorithm = algorithm;
        _key = algorithm == WebAuthn.Rs256 ? RSA.Create(2048) : ECDsa.Create(curve ?? ECCurve.NamedCurves.nistP256);
    }

    public int Algorithm { get; }

    public byte[] CredentialId { get; } = RandomNumberGenerator.GetBytes(16);

    public byte[]? UserHandle { get; private set; }

    public uint Counter { get; set; }

    /// <summary>Whether the user is verified (fingerprint, face or PIN).</summary>
    public bool Verifies { get; set; } = true;

    public string Origin { get; set; } = "http://localhost";

    public string RpId { get; set; } = "localhost";

    public byte[] PublicKey => _key switch
    {
        ECDsa ec => ec.ExportSubjectPublicKeyInfo(),
        RSA rsa => rsa.ExportSubjectPublicKeyInfo(),
        _ => throw new InvalidOperationException(),
    };

    public NewPasskeyCredential Create(PasskeyCreationOptions options, string type = "webauthn.create")
    {
        UserHandle = options.User.Id;
        var clientData = ClientData(type, options.Challenge);
        var attested = new byte[16 + 2 + CredentialId.Length + 4];
        BinaryPrimitives.WriteUInt16BigEndian(attested.AsSpan(16), (ushort)CredentialId.Length);
        CredentialId.CopyTo(attested, 18); // the COSE key that follows is not read by the server; 4 filler bytes
        var authData = AuthData((byte)(Flags() | At), attested);
        return new NewPasskeyCredential(CredentialId, clientData, authData, PublicKey, Algorithm, ["internal", "hybrid", "bogus"]);
    }

    public PasskeyAssertion Sign(PasskeyRequestOptions options, string type = "webauthn.get")
    {
        var clientData = ClientData(type, options.Challenge);
        var authData = AuthData(Flags(), []);
        var signed = authData.Concat(SHA256.HashData(clientData)).ToArray();
        var signature = _key switch
        {
            ECDsa ec => ec.SignData(signed, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence),
            RSA rsa => rsa.SignData(signed, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1),
            _ => throw new InvalidOperationException(),
        };
        return new PasskeyAssertion(CredentialId, clientData, authData, signature, UserHandle);
    }

    public void Dispose() => _key.Dispose();

    private byte Flags() => (byte)(Up | (Verifies ? Uv : 0) | Be | Bs);

    private byte[] ClientData(string type, byte[] challenge) =>
        Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            type,
            challenge = WebAuthn.Base64Url(challenge),
            origin = Origin,
            crossOrigin = false,
        }));

    private byte[] AuthData(byte flags, byte[] rest)
    {
        var data = new byte[37 + rest.Length];
        SHA256.HashData(Encoding.UTF8.GetBytes(RpId)).CopyTo(data, 0);
        data[32] = flags;
        BinaryPrimitives.WriteUInt32BigEndian(data.AsSpan(33), Counter);
        rest.CopyTo(data, 37);
        return data;
    }
}
