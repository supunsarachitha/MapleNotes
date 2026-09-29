using System.Security.Cryptography;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Infrastructure.Hosting;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Storage;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace MapleNotes.Server.Infrastructure;

/// <summary>Registers the infrastructure services: settings, keys, database, file storage and Data Protection.</summary>
internal static class InfrastructureServiceCollectionExtensions
{
    /// <summary>
    /// Adds the infrastructure services.
    /// </summary>
    /// <remarks>
    /// Settings and keys are resolved lazily from configuration when first needed (during
    /// <see cref="StartupInitializer"/>), so configuration supplied late, for example by integration tests, is honoured.
    /// </remarks>
    /// <param name="services">The service collection.</param>
    /// <returns>The same service collection.</returns>
    public static IServiceCollection AddMapleInfrastructure(this IServiceCollection services)
    {
        services.TryAddSingleton(TimeProvider.System);

        services.AddSingleton(provider => MapleOptions.FromConfiguration(
            provider.GetRequiredService<IConfiguration>(),
            provider.GetRequiredService<IHostEnvironment>().ContentRootPath));

        services.AddSingleton(provider =>
        {
            var masterKey = MasterKey.Load(provider.GetRequiredService<IConfiguration>());
            try
            {
                return new KeyMaterial(masterKey);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(masterKey);
            }
        });

        services.AddSingleton<DataKeyService>();
        services.AddScoped<UserContentKeys>();
        services.AddSingleton<AttachmentStore>();

        services.AddSingleton(provider => new DatabaseConnectionString(SqlCipherConnectionString.Build(
            provider.GetRequiredService<MapleOptions>().DatabasePath,
            provider.GetRequiredService<KeyMaterial>().DatabaseKey)));
        services.AddDbContext<MapleDbContext>((provider, db) => db
            .UseSqlite(provider.GetRequiredService<DatabaseConnectionString>().Value)
            .AddInterceptors(new SqlitePragmaInterceptor()));
        services.AddScoped<DatabaseInitializer>();

        services.AddMapleDataProtection();
        services.AddHostedService<StartupInitializer>();
        services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("database");

        return services;
    }

    /// <summary>
    /// Configures ASP.NET Core Data Protection, which signs sign-in cookies and antiforgery tokens.
    /// </summary>
    /// <remarks>
    /// The key ring lives in the data directory so sessions survive restarts and container upgrades. Every key is
    /// encrypted with a key derived from the master key before it is written (see <see cref="MasterKeyXmlEncryptor"/>).
    /// Requires <see cref="MapleOptions"/> and <see cref="KeyMaterial"/> to be registered.
    /// </remarks>
    /// <param name="services">The service collection.</param>
    /// <returns>The same service collection.</returns>
    public static IServiceCollection AddMapleDataProtection(this IServiceCollection services)
    {
        services.AddDataProtection().SetApplicationName("MapleNotes");
        services.AddOptions<KeyManagementOptions>()
            .Configure<MapleOptions, KeyMaterial, ILoggerFactory>((keyManagement, options, keys, loggerFactory) =>
            {
                keyManagement.XmlRepository = new FileSystemXmlRepository(new DirectoryInfo(options.KeysDirectory), loggerFactory);
                keyManagement.XmlEncryptor = new MasterKeyXmlEncryptor(keys);
            });

        return services;
    }
}
