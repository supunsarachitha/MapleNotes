using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace MapleNotes.Server.Features.Storage;

/// <summary>Storage usage: the signed-in account's, and (for administrators) the instance's.</summary>
/// <param name="storage">Measures storage.</param>
[ApiController]
[Produces("application/json")]
public sealed class StorageController(StorageService storage) : ControllerBase
{
    /// <summary>Returns how much the signed-in account stores.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>Sizes and counts of notes and files.</returns>
    /// <response code="200">The usage.</response>
    [HttpGet("api/v1/account/storage")]
    [ProducesResponseType<StorageUsageResponse>(StatusCodes.Status200OK)]
    public Task<StorageUsageResponse> GetUsage(CancellationToken cancellationToken) =>
        storage.GetUsageAsync(User.GetUserId(), cancellationToken);

    /// <summary>Returns what the instance stores on its data volume, and the free space there.</summary>
    /// <returns>Database, files, backups and free space, in bytes.</returns>
    /// <response code="200">The storage.</response>
    /// <response code="403">Not an administrator.</response>
    [HttpGet("api/v1/admin/storage")]
    [Authorize(Roles = nameof(UserRole.Admin))]
    [ProducesResponseType<InstanceStorageResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public InstanceStorageResponse GetInstanceStorage() => storage.GetInstanceStorage();
}
