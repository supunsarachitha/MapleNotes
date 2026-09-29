using MapleNotes.Server.Features.Admin;
using MapleNotes.Server.Features.Attachments;
using MapleNotes.Server.Features.Auth;
using MapleNotes.Server.Features.Encryption;
using MapleNotes.Server.Features.EndToEnd;
using MapleNotes.Server.Features.Export;
using MapleNotes.Server.Features.LinkPreviews;
using MapleNotes.Server.Features.Notes;
using MapleNotes.Server.Features.Preferences;
using MapleNotes.Server.Features.Storage;

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
        services.AddScoped<AccountDeletionService>();
        services.AddScoped<InstanceSettingsService>();
        services.AddScoped<UserAdministrationService>();
        services.AddScoped<PreferencesService>();
        services.AddScoped<StorageService>();

        services.AddScoped<NoteService>();
        services.AddScoped<AttachmentService>();
        services.AddScoped<AttachmentCleanup>();
        services.AddHostedService<AttachmentCleanupService>();

        services.AddScoped<NoteExporter>();

        // Link previews: a client that connects only to public addresses and never follows redirects by itself.
        services.AddMemoryCache();
        services.AddSingleton<LinkPreviewService>();
        services.AddHttpClient(LinkPreviewService.ClientName, client =>
            {
                client.Timeout = TimeSpan.FromSeconds(10);
                client.DefaultRequestHeaders.UserAgent.ParseAdd("MapleNotes/1.2 (link preview)");
            })
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
            {
                AllowAutoRedirect = false,
                UseCookies = false,
                UseProxy = false,
                AutomaticDecompression = System.Net.DecompressionMethods.All,
                ConnectTimeout = TimeSpan.FromSeconds(5),
                PooledConnectionLifetime = TimeSpan.FromMinutes(2),
                ConnectCallback = NetworkGuard.ConnectAsync,
            });

        services.AddScoped<EncryptionSettingsService>();
        services.AddScoped<EndToEndService>();
        services.AddScoped<EncryptionKeyCleanup>();
        services.AddScoped<ConversionService>();
        services.AddScoped<EncryptionMigrator>();
        services.AddSingleton<EncryptionMigrationSignal>();
        services.AddHostedService<EncryptionMigrationService>();

        return services;
    }
}
