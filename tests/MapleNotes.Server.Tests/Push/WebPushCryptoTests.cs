using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MapleNotes.Server.Features.Push;
using Microsoft.AspNetCore.WebUtilities;

namespace MapleNotes.Server.Tests.Push;

public sealed class WebPushCryptoTests
{
    private static byte[] B(string base64Url) => WebEncoders.Base64UrlDecode(base64Url);

    [Fact]
    public void Encryption_reproduces_the_rfc_8291_example()
    {
        // RFC 8291 §5 and Appendix A.
        var senderPublic = B("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
        using var sender = ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            D = B("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
            Q = new ECPoint { X = senderPublic[1..33], Y = senderPublic[33..] },
        });

        var body = WebPushCrypto.Encrypt(
            Encoding.ASCII.GetBytes("When I grow up, I want to be a watermelon"),
            B("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
            B("BTBZMqHH6r4Tts7J_aSIgg"), sender, B("DGv6ra1nlYgDCS1FRnbzlw"));

        Assert.Equal(
            "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
            WebEncoders.Base64UrlEncode(body));
    }

    [Fact]
    public void Vapid_header_carries_a_verifiable_es256_token_for_the_push_service()
    {
        var (publicKey, privateKey) = WebPushCrypto.GenerateKeys();
        var expires = DateTimeOffset.FromUnixTimeSeconds(1_900_000_000);
        var header = WebPushCrypto.VapidAuthorization(
            new Uri("https://fcm.googleapis.com/fcm/send/abc:123"), publicKey, privateKey, "https://notes.example", expires);

        Assert.StartsWith("vapid t=", header);
        var parts = header["vapid t=".Length..].Split(", k=");
        Assert.Equal(WebEncoders.Base64UrlEncode(publicKey), parts[1]);
        var jwt = parts[0].Split('.');
        using var claims = JsonDocument.Parse(B(jwt[1]));
        Assert.Equal("https://fcm.googleapis.com", claims.RootElement.GetProperty("aud").GetString());
        Assert.Equal(1_900_000_000, claims.RootElement.GetProperty("exp").GetInt64());
        Assert.Equal("https://notes.example", claims.RootElement.GetProperty("sub").GetString());
        using var verifier = ECDsa.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256, Q = new ECPoint { X = publicKey[1..33], Y = publicKey[33..] },
        });
        Assert.True(verifier.VerifyData(Encoding.ASCII.GetBytes($"{jwt[0]}.{jwt[1]}"), B(jwt[2]), HashAlgorithmName.SHA256));
    }

    [Fact]
    public void Only_points_on_the_curve_are_accepted_as_subscription_keys()
    {
        Assert.True(WebPushCrypto.IsValidPublicKey(WebPushCrypto.GenerateKeys().PublicKey));
        var offCurve = WebPushCrypto.GenerateKeys().PublicKey;
        offCurve[64] ^= 1;
        Assert.False(WebPushCrypto.IsValidPublicKey(offCurve));
        Assert.False(WebPushCrypto.IsValidPublicKey(new byte[33]));
    }
}
