using MapleNotes.Server.Domain;
using MapleNotes.Server.Features.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace MapleNotes.Server.Features.Storage;

/// <summary>Storage usage: the signed-in account's, and (for administrators) the instance's.</summary>
/// <param name="storage">Measures storage.</param>
/// <param name="quota">The storage limit per account.</param>
[ApiController]
[Produces("application/json")]
public sealed class StorageController(StorageService storage, StorageQuota quota) : ControllerBase
{
    /// <summary>Returns how much the signed-in account stores, and the most it may store.</summary>
    /// <param name="cancellationToken">Cancels the request.</param>
    /// <returns>Sizes and counts of notes and files, and the limit if an administrator set one.</returns>
    /// <response code="200">The usage.</response>
    [HttpGet("api/v1/account/storage")]
    [ProducesResponseType<StorageUsageResponse>(StatusCodes.Status200OK)]
    public async Task<StorageUsageResponse> GetUsage(CancellationToken cancellationToken) =>
        await storage.GetUsageAsync(User.GetUserId(), cancellationToken) with { QuotaBytes = await quota.GetLimitBytesAsync(cancellationToken) };

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
