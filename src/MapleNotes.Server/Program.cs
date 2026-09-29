// Maple Notes server entry point.
//
// Architecture (see docs/architecture.md for the full picture):
//   - One ASP.NET Core process serves both the REST API (/api/v1/...) and the compiled React SPA from wwwroot.
//   - All persistent state lives under the data directory (default /app/data): the SQLCipher-format database,
//     encrypted attachment files and the ASP.NET Core Data Protection key ring.
//   - The root secret (MAPLE_MASTER_KEY) is supplied at runtime and never written to the data directory.
//
// Command-line modes (used by Docker):
//   generate-key    print a new random master key and exit
//   backup          write an encrypted copy of the database to {data}/backups while the server keeps running
//   --healthcheck   probe the running server's /healthz endpoint and exit 0 (healthy) or 1

using MapleNotes.Server.Features;
using MapleNotes.Server.Infrastructure;
using MapleNotes.Server.Infrastructure.Configuration;
using MapleNotes.Server.Infrastructure.Crypto;
using MapleNotes.Server.Infrastructure.Hosting;
using MapleNotes.Server.Infrastructure.Persistence;
using MapleNotes.Server.Infrastructure.Web;
using Scalar.AspNetCore;

if (args is ["generate-key"])
{
    Console.WriteLine(MasterKey.Generate());
    return 0;
}

if (args.Contains(HealthProbe.CommandLineSwitch, StringComparer.OrdinalIgnoreCase))
{
    // The runtime image has no shell or curl, so the app probes itself.
    return await HealthProbe.RunAsync();
}

var builder = WebApplication.CreateBuilder(args is ["backup"] ? [] : args);

// Small request bodies everywhere (the largest JSON request is a 100,000-character note); the attachment upload
// endpoint raises the limit for its own requests to MAPLE_MAX_UPLOAD_MB.
builder.WebHost.ConfigureKestrel(kestrel => kestrel.Limits.MaxRequestBodySize = 2 * 1024 * 1024);

builder.Services.AddMapleInfrastructure();
builder.Services.AddMapleWeb();
builder.Services.AddMapleFeatures();

var app = builder.Build();

if (args is ["backup"])
{
    // Online backup: a consistent, encrypted copy of the database taken while the server keeps running
    // (docker exec maple-notes dotnet /app/MapleNotes.Server.dll backup).
    try
    {
        var options = app.Services.GetRequiredService<MapleOptions>();
        if (!File.Exists(options.DatabasePath))
        {
            throw new MapleStartupException($"There is no database at '{options.DatabasePath}' to back up. Check {MapleOptions.DataDirectoryKey}.");
        }

        await using var scope = app.Services.CreateAsyncScope();
        var path = scope.ServiceProvider.GetRequiredService<DatabaseInitializer>().BackupDatabase("manual");
        Console.WriteLine(path);
        return 0;
    }
    catch (Exception ex) when (FindStartupError(ex) is { } startupError)
    {
        await Console.Error.WriteLineAsync($"Maple Notes cannot back up: {startupError.Message}");
        return 1;
    }
}

app.UseForwardedHeaders();
app.UseMapleSecurityHeaders();
app.UseExceptionHandler();
if (!app.Environment.IsDevelopment())
{
    app.UseHsts(); // only sent on HTTPS requests, i.e. behind a TLS-terminating proxy listed in MAPLE_TRUSTED_PROXIES
}

app.UseDefaultFiles();
app.UseStaticFiles(SecurityHeaders.SpaStaticFiles);

app.UseRouting();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHealthChecks("/healthz");

// Interactive API reference (/scalar) and OpenAPI document (/openapi/v1.json).
if (app.Environment.IsDevelopment() || app.Configuration.GetValue<bool>(MapleOptions.ApiDocsKey))
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

// Unknown API routes must return 404 instead of falling through to the SPA's index.html.
app.MapFallback("/api/{**path}", () => Results.NotFound());

// Every other unknown route belongs to the client-side router.
app.MapFallbackToFile("index.html", SecurityHeaders.SpaStaticFiles);

try
{
    await app.RunAsync();
    return 0;
}
catch (Exception ex) when (FindStartupError(ex) is { } startupError)
{
    // Configuration problems are reported as one actionable line rather than a stack trace.
    await Console.Error.WriteLineAsync($"Maple Notes cannot start: {startupError.Message}");
    return 1;
}

static MapleStartupException? FindStartupError(Exception? exception) => exception switch
{
    null => null,
    MapleStartupException startupError => startupError,
    AggregateException aggregate => aggregate.InnerExceptions.Select(FindStartupError).FirstOrDefault(e => e is not null),
    _ => FindStartupError(exception.InnerException),
};
