using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;

namespace MapleNotes.Server.Features.Push;

/// <summary>
/// Web Push with .NET's own cryptography: message encryption (RFC 8291, the <c>aes128gcm</c> content coding of RFC 8188)
/// and the VAPID authorization header (RFC 8292). Keys are P-256, public keys in the 65-byte uncompressed form.
/// </summary>
public static class WebPushCrypto
{
    /// <summary>Record size written in the header; one record holds any message the push services accept.</summary>
    private const int RecordSize = 4096;

    /// <summary>The most plaintext one push message can carry (4096 bytes of body less header, delimiter and tag).</summary>
    public const int MaxPlaintextBytes = 3993;

    /// <summary>A new VAPID key pair: the public key (65 bytes) and the private scalar (32 bytes).</summary>
    /// <returns>The key pair.</returns>
    public static (byte[] PublicKey, byte[] PrivateKey) GenerateKeys()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var p = key.ExportParameters(includePrivateParameters: true);
        return (Uncompressed(p.Q), p.D!);
    }

    /// <summary>
    /// Whether the bytes are a valid P-256 public key in uncompressed form (RFC 8291 §7 asks receivers' keys to be
    /// checked: importing validates that the point is on the curve).
    /// </summary>
    /// <param name="publicKey">The key.</param>
    /// <returns>True when valid.</returns>
    public static bool IsValidPublicKey(byte[] publicKey)
    {
        if (publicKey is not { Length: 65 } || publicKey[0] != 0x04)
        {
            return false;
        }

        try
        {
            using var key = ECDiffieHellman.Create(Parameters(publicKey));
            return true;
        }
        catch (CryptographicException)
        {
            return false;
        }
    }

    /// <summary>Encrypts a push message for one subscription (RFC 8291 §3.4), as the request body to send.</summary>
    /// <param name="plaintext">The message, at most <see cref="MaxPlaintextBytes"/>.</param>
    /// <param name="userAgentPublicKey">The subscription's <c>p256dh</c> key.</param>
    /// <param name="authSecret">The subscription's 16-byte <c>auth</c> secret.</param>
    /// <param name="senderKey">The one-time sender key; a new one when null (tests pass the RFC's).</param>
    /// <param name="salt">The 16-byte salt; random when null.</param>
    /// <returns>Header (salt, record size, sender public key) followed by the ciphertext and tag.</returns>
    public static byte[] Encrypt(byte[] plaintext, byte[] userAgentPublicKey, byte[] authSecret, ECDiffieHellman? senderKey = null, byte[]? salt = null)
    {
        ArgumentOutOfRangeException.ThrowIfGreaterThan(plaintext.Length, MaxPlaintextBytes);
        using var ownKey = senderKey is null ? ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256) : null;
        var sender = senderKey ?? ownKey!;
        salt ??= RandomNumberGenerator.GetBytes(16);
        var senderPublic = Uncompressed(sender.ExportParameters(false).Q);

        using var receiver = ECDiffieHellman.Create(Parameters(userAgentPublicKey));
        var ecdhSecret = sender.DeriveRawSecretAgreement(receiver.PublicKey);

        var keyInfo = Concat(Encoding.ASCII.GetBytes("WebPush: info\0"), userAgentPublicKey, senderPublic);
        var ikm = HKDF.DeriveKey(HashAlgorithmName.SHA256, ecdhSecret, 32, authSecret, keyInfo);
        var prk = HKDF.Extract(HashAlgorithmName.SHA256, ikm, salt);
        var cek = HKDF.Expand(HashAlgorithmName.SHA256, prk, 16, Encoding.ASCII.GetBytes("Content-Encoding: aes128gcm\0"));
        var nonce = HKDF.Expand(HashAlgorithmName.SHA256, prk, 12, Encoding.ASCII.GetBytes("Content-Encoding: nonce\0"));

        var record = new byte[plaintext.Length + 1];
        plaintext.CopyTo(record, 0);
        record[^1] = 0x02; // the last (and only) record's padding delimiter
        var ciphertext = new byte[record.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(cek, 16))
        {
            aes.Encrypt(nonce, record, ciphertext, tag);
        }

        var header = new byte[16 + 4 + 1 + senderPublic.Length];
        salt.CopyTo(header, 0);
        BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(16), RecordSize);
        header[20] = (byte)senderPublic.Length;
        senderPublic.CopyTo(header, 21);
        return Concat(header, ciphertext, tag);
    }

    /// <summary>The <c>Authorization</c> header value for a push service (RFC 8292): <c>vapid t=&lt;JWT&gt;, k=&lt;key&gt;</c>.</summary>
    /// <param name="endpoint">The subscription's endpoint; its origin is the JWT audience.</param>
    /// <param name="publicKey">The VAPID public key.</param>
    /// <param name="privateKey">The VAPID private scalar.</param>
    /// <param name="subject">Contact for the push service: a <c>mailto:</c> or <c>https:</c> URL.</param>
    /// <param name="expires">When the token stops being valid (at most 24 hours ahead).</param>
    /// <returns>The header value.</returns>
    public static string VapidAuthorization(Uri endpoint, byte[] publicKey, byte[] privateKey, string subject, DateTimeOffset expires)
    {
        var header = Base64Json(new Dictionary<string, object> { ["typ"] = "JWT", ["alg"] = "ES256" });
        var claims = Base64Json(new Dictionary<string, object>
        {
            ["aud"] = endpoint.GetLeftPart(UriPartial.Authority),
            ["exp"] = expires.ToUnixTimeSeconds(),
            ["sub"] = subject,
        });
        var parameters = Parameters(publicKey);
        parameters.D = privateKey;
        using var key = ECDsa.Create(parameters);
        var signature = key.SignData(Encoding.ASCII.GetBytes($"{header}.{claims}"), HashAlgorithmName.SHA256); // IEEE P1363 r||s, as JWS wants
        return $"vapid t={header}.{claims}.{WebEncoders.Base64UrlEncode(signature)}, k={WebEncoders.Base64UrlEncode(publicKey)}";
    }

    private static string Base64Json(Dictionary<string, object> value) =>
        WebEncoders.Base64UrlEncode(JsonSerializer.SerializeToUtf8Bytes(value));

    private static ECParameters Parameters(byte[] uncompressed) => new()
    {
        Curve = ECCurve.NamedCurves.nistP256,
        Q = new ECPoint { X = uncompressed[1..33], Y = uncompressed[33..65] },
    };

    private static byte[] Uncompressed(ECPoint q) => Concat([0x04], q.X!, q.Y!);

    private static byte[] Concat(params byte[][] parts)
    {
        var result = new byte[parts.Sum(p => p.Length)];
        var offset = 0;
        foreach (var part in parts)
        {
            part.CopyTo(result, offset);
            offset += part.Length;
        }

        return result;
    }
}
