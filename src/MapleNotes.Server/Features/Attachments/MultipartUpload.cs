using MapleNotes.Server.Infrastructure.Web;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Net.Http.Headers;

namespace MapleNotes.Server.Features.Attachments;

/// <summary>A file part of a streamed upload, with the small form fields sent before it.</summary>
/// <param name="FileName">The file name the client gave, if any.</param>
/// <param name="ContentType">The part's content type, if any.</param>
/// <param name="Body">The file content, read once as it arrives.</param>
/// <param name="Fields">Form fields read before the file part.</param>
internal sealed record UploadedFile(string? FileName, string? ContentType, Stream Body, IReadOnlyDictionary<string, string> Fields)
{
    /// <summary>A field parsed as a GUID, or null.</summary>
    public Guid? Guid(string name) => Fields.TryGetValue(name, out var value) && System.Guid.TryParse(value, out var id) ? id : null;

    /// <summary>A field decoded from base64, or null when absent, malformed or longer than <paramref name="maxBytes"/>.</summary>
    public byte[]? Base64(string name, int maxBytes)
    {
        var buffer = new byte[maxBytes];
        return Fields.TryGetValue(name, out var value) && Convert.TryFromBase64String(value, buffer, out var written) ? buffer[..written] : null;
    }
}

/// <summary>
/// Reads <c>multipart/form-data</c> as a stream, so a file is never buffered whole: small form fields first, then
/// the first file part, which is handed to the caller while it arrives.
/// </summary>
internal static class MultipartUpload
{
    private const int MaxFieldLength = 4 * 1024;

    /// <summary>Reads the request and passes its first file part to <paramref name="onFile"/>.</summary>
    /// <param name="request">The HTTP request.</param>
    /// <param name="fieldNames">Form fields to keep; others are skipped.</param>
    /// <param name="onFile">Consumes the file part.</param>
    /// <param name="cancellationToken">Cancels reading.</param>
    /// <typeparam name="T">What <paramref name="onFile"/> returns.</typeparam>
    /// <returns>The result of <paramref name="onFile"/>.</returns>
    /// <exception cref="ApiProblemException">The request is not valid multipart, has no file, or a field is too long (400).</exception>
    public static async Task<T> ReadAsync<T>(
        HttpRequest request, IReadOnlySet<string> fieldNames, Func<UploadedFile, Task<T>> onFile, CancellationToken cancellationToken)
    {
        if (!MediaTypeHeaderValue.TryParse(request.ContentType, out var mediaType)
            || HeaderUtilities.RemoveQuotes(mediaType.Boundary).Value is not { Length: > 0 and <= 70 } boundary)
        {
            throw new ApiProblemException(StatusCodes.Status400BadRequest, "The upload is not valid multipart/form-data.");
        }

        var reader = new MultipartReader(boundary, request.Body) { HeadersLengthLimit = 16 * 1024 };
        var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        while (await reader.ReadNextSectionAsync(cancellationToken) is { } section)
        {
            if (!ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var disposition))
            {
                continue;
            }

            if (disposition.IsFormDisposition())
            {
                var name = HeaderUtilities.RemoveQuotes(disposition.Name).Value ?? string.Empty;
                if (fieldNames.Contains(name))
                {
                    fields[name] = await ReadFieldAsync(section.Body, cancellationToken)
                        ?? throw new ApiProblemException(StatusCodes.Status400BadRequest, $"The form field '{name}' is too long.");
                }

                continue;
            }

            if (disposition.IsFileDisposition())
            {
                var fileName = disposition.FileNameStar.HasValue
                    ? disposition.FileNameStar.Value
                    : HeaderUtilities.RemoveQuotes(disposition.FileName).Value;
                return await onFile(new UploadedFile(fileName, section.ContentType, section.Body, fields));
            }
        }

        throw new ApiProblemException(StatusCodes.Status400BadRequest, "The upload contains no file.");
    }

    private static async Task<string?> ReadFieldAsync(Stream body, CancellationToken cancellationToken)
    {
        var buffer = new byte[MaxFieldLength + 1];
        var length = await body.ReadAtLeastAsync(buffer, buffer.Length, throwOnEndOfStream: false, cancellationToken);
        return length > MaxFieldLength ? null : System.Text.Encoding.UTF8.GetString(buffer, 0, length).Trim();
    }
}
