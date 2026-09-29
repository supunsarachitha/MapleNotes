using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace MapleNotes.Server.Infrastructure.Persistence;

/// <summary>
/// Creates a <see cref="MapleDbContext"/> for the <c>dotnet ef</c> command-line tools, which only need the model to
/// generate migrations. It never opens a database and is not used at runtime.
/// </summary>
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<MapleDbContext>
{
    /// <inheritdoc />
    public MapleDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<MapleDbContext>().UseSqlite("Data Source=design-time-only.db").Options);
}
