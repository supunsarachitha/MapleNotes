using MapleNotes.Server.Domain;
using MapleNotes.Server.Infrastructure.Web;

namespace MapleNotes.Server.Features.Encryption;

/// <summary>Maps an account's encryption mode to how the server stores content it receives as plain text.</summary>
public static class ContentSchemes
{
    /// <summary>
    /// Returns the scheme for plain-text content the server stores itself, and refuses plain text for end-to-end
    /// accounts: their content must arrive already encrypted by the browser.
    /// </summary>
    /// <param name="mode">The owner's encryption mode.</param>
    /// <returns><see cref="ContentScheme.None"/> or <see cref="ContentScheme.Server"/>.</returns>
    /// <exception cref="ApiProblemException">The account uses end-to-end encryption (HTTP 409).</exception>
    public static ContentScheme ForPlainText(EncryptionMode mode) => mode switch
    {
        EncryptionMode.Off => ContentScheme.None,
        EncryptionMode.AtRest => ContentScheme.Server,
        _ => throw new ApiProblemException(
            StatusCodes.Status409Conflict,
            "This account uses end-to-end encryption.",
            "Notes and files must be encrypted by the app before they are sent. Reload the page to update the app."),
    };

    /// <summary>
    /// The scheme the server converts existing content to in the background, or null for end-to-end accounts, whose
    /// content only the browser can convert.
    /// </summary>
    /// <param name="mode">The owner's encryption mode.</param>
    /// <returns>The target scheme, or null.</returns>
    public static ContentScheme? ServerTarget(EncryptionMode mode) => mode switch
    {
        EncryptionMode.Off => ContentScheme.None,
        EncryptionMode.AtRest => ContentScheme.Server,
        _ => null,
    };

    /// <summary>
    /// Returns the scheme for an attachment file the server stores from plaintext, and refuses plaintext for
    /// end-to-end accounts. Unlike notes, files are always encrypted: they live outside the encrypted database, so
    /// "off" uses the instance attachment key.
    /// </summary>
    /// <param name="mode">The owner's encryption mode.</param>
    /// <returns><see cref="ContentScheme.Instance"/> or <see cref="ContentScheme.Server"/>.</returns>
    /// <exception cref="ApiProblemException">The account uses end-to-end encryption (HTTP 409).</exception>
    public static ContentScheme ForAttachment(EncryptionMode mode) =>
        ForPlainText(mode) == ContentScheme.Server ? ContentScheme.Server : ContentScheme.Instance;

    /// <summary>
    /// The scheme the server converts existing attachment files to in the background. For end-to-end accounts this is
    /// <see cref="ContentScheme.Instance"/>, applied only to plaintext files left from before 1.22 that the browser
    /// has not converted yet, so they are not kept on disk as plaintext meanwhile.
    /// </summary>
    /// <param name="mode">The owner's encryption mode.</param>
    /// <returns>The target scheme.</returns>
    public static ContentScheme AttachmentServerTarget(EncryptionMode mode) =>
        mode == EncryptionMode.AtRest ? ContentScheme.Server : ContentScheme.Instance;

    /// <summary>The scheme the account's content is converted to, per kind of content (for progress reports).</summary>
    /// <param name="mode">The owner's encryption mode.</param>
    /// <returns>The target for notes and for attachment files.</returns>
    public static (ContentScheme Notes, ContentScheme Attachments) Targets(EncryptionMode mode) => mode switch
    {
        EncryptionMode.Off => (ContentScheme.None, ContentScheme.Instance),
        EncryptionMode.AtRest => (ContentScheme.Server, ContentScheme.Server),
        _ => (ContentScheme.EndToEnd, ContentScheme.EndToEnd),
    };
}
