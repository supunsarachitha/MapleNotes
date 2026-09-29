using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;
using Microsoft.AspNetCore.DataProtection.XmlEncryption;

namespace MapleNotes.Server.Infrastructure.Crypto;

/// <summary>
/// Encrypts ASP.NET Core Data Protection keys before they are written to the key ring in the data directory.
/// </summary>
/// <remarks>
/// Data Protection keys sign authentication cookies and antiforgery tokens. On Linux they are stored unencrypted by
/// default, so anyone holding a copy of the data volume could forge a login cookie. Encrypting them with a key derived
/// from <c>MAPLE_MASTER_KEY</c> (which is not on the volume) closes that gap.
/// </remarks>
/// <param name="keys">The instance key hierarchy.</param>
internal sealed class MasterKeyXmlEncryptor(KeyMaterial keys) : IXmlEncryptor
{
    /// <summary>Context bound into every encrypted key-ring element.</summary>
    internal static readonly byte[] AssociatedData = "maple-notes/v1/data-protection-key-ring"u8.ToArray();

    /// <inheritdoc />
    public EncryptedXmlInfo Encrypt(XElement plaintextElement)
    {
        ArgumentNullException.ThrowIfNull(plaintextElement);

        var plaintext = Encoding.UTF8.GetBytes(plaintextElement.ToString(SaveOptions.DisableFormatting));
        try
        {
            var envelope = AeadEnvelope.Seal(keys.DataProtectionKey, keyVersion: 1, plaintext, AssociatedData);
            var element = new XElement(
                "encryptedKey",
                new XComment(" Encrypted with AES-256-GCM using a key derived from MAPLE_MASTER_KEY. "),
                new XElement("value", Convert.ToBase64String(envelope)));
            return new EncryptedXmlInfo(element, typeof(MasterKeyXmlDecryptor));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }
}

/// <summary>
/// Decrypts key-ring elements written by <see cref="MasterKeyXmlEncryptor"/>.
/// </summary>
/// <remarks>
/// Data Protection creates this type by name when it reads the key ring, using its public constructor that takes an
/// <see cref="IServiceProvider"/>; that is why the dependency is resolved from the provider instead of injected.
/// </remarks>
/// <param name="services">The application's service provider.</param>
internal sealed class MasterKeyXmlDecryptor(IServiceProvider services) : IXmlDecryptor
{
    /// <inheritdoc />
    public XElement Decrypt(XElement encryptedElement)
    {
        ArgumentNullException.ThrowIfNull(encryptedElement);

        var keys = services.GetRequiredService<KeyMaterial>();
        var value = encryptedElement.Element("value")?.Value
            ?? throw new CryptographicException("The encrypted Data Protection key is missing its value.");

        var plaintext = AeadEnvelope.Open(keys.DataProtectionKey, Convert.FromBase64String(value), MasterKeyXmlEncryptor.AssociatedData);
        try
        {
            return XElement.Parse(Encoding.UTF8.GetString(plaintext));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }
}
