using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.Notes;

namespace MapleNotes.Server.Features;

/// <summary>Registers the application features (the services behind the API controllers).</summary>
internal static class FeatureServiceCollectionExtensions
{
    /// <summary>Adds the feature services.</summary>
    /// <param name="services">The service collection.</param>
    /// <returns>The same service collection.</returns>
    public static IServiceCollection AddMapleFeatures(this IServiceCollection services)
    {
        services.AddScoped<AccountService>();
        services.AddScoped<InstanceSettingsService>();
        services.AddScoped<UserAdministrationService>();

        services.AddScoped<NoteService>();
        services.AddScoped<AttachmentService>();
        services.AddScoped<AttachmentCleanup>();
        services.AddHostedService<AttachmentCleanupService>();

        return services;
    }
}
