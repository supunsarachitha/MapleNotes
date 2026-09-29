// Maple Notes server entry point.
//
// Architecture (see docs/architecture.md for the full picture):
//   - One ASP.NET Core process serves both the REST API (/api/v1/...) and the compiled React SPA from wwwroot.
//   - All persistent state lives under the data directory (default /app/data): the SQLCipher-format database,
//     encrypted attachment files and the ASP.NET Core Data Protection key ring.
//   - The root secret (MAPLE_MASTER_KEY) is supplied at runtime and never written to the data directory.

using MapleNotes.Server.Infrastructure.Hosting;

if (args.Contains(HealthProbe.CommandLineSwitch, StringComparer.OrdinalIgnoreCase))
{
    // Invoked by the Docker HEALTHCHECK. The runtime image has no shell or curl, so the app probes itself.
    return await HealthProbe.RunAsync();
}

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddHealthChecks();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapHealthChecks("/healthz");

// Unknown API routes must return 404 instead of falling through to the SPA's index.html.
app.MapFallback("/api/{**path}", () => Results.NotFound());

// Every other unknown route belongs to the client-side router.
app.MapFallbackToFile("index.html");

await app.RunAsync();
return 0;
