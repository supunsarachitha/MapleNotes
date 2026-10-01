using System.Text.Json;
using MapleNotes.Server.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace MapleNotes.Server.Infrastructure.Persistence;

/// <summary>
/// Entity Framework Core context for the Maple Notes database: SQLite, encrypted as a whole in SQLCipher v4 format
/// (see <see cref="SqlCipherConnectionString"/>).
/// </summary>
/// <param name="options">Context options, including the encrypted connection string.</param>
public sealed class MapleDbContext(DbContextOptions<MapleDbContext> options) : DbContext(options)
{
    /// <summary>Accounts.</summary>
    public DbSet<User> Users => Set<User>();

    /// <summary>Notes of all users; always filter by owner.</summary>
    public DbSet<Note> Notes => Set<Note>();

    /// <summary>Attachment metadata; the files themselves live in the attachment store.</summary>
    public DbSet<Attachment> Attachments => Set<Attachment>();

    /// <summary>Per-user tags.</summary>
    public DbSet<Tag> Tags => Set<Tag>();

    /// <summary>Per-user labels.</summary>
    public DbSet<Label> Labels => Set<Label>();

    /// <summary>Runtime-editable instance settings.</summary>
    public DbSet<InstanceSetting> InstanceSettings => Set<InstanceSetting>();

    /// <inheritdoc />
    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        BumpRevisions();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    /// <inheritdoc />
    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        BumpRevisions();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    /// <inheritdoc />
    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        // SQLite has no date type. EF stores DateTime as ISO-8601 text, which sorts chronologically but loses the
        // DateTimeKind. Every timestamp in this model is UTC, so values read back are marked as UTC.
        configurationBuilder.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>();
        configurationBuilder.Properties<DateTime?>().HaveConversion<UtcDateTimeConverter>();
    }

    // Preferences are stored as JSON; fields added later take their default value in older rows.
    private static readonly JsonSerializerOptions PreferencesJson = new(JsonSerializerDefaults.Web);

    /// <inheritdoc />
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(user =>
        {
            user.ToTable("Users");
            user.Property(u => u.Username).HasMaxLength(64);
            user.Property(u => u.NormalizedUsername).HasMaxLength(64);
            user.HasIndex(u => u.NormalizedUsername).IsUnique();
            user.Property(u => u.DisplayName).HasMaxLength(100);
            user.Property(u => u.Role).HasConversion<string>().HasMaxLength(16);
            user.Property(u => u.SecurityStamp).HasMaxLength(64);
            user.Property(u => u.CredentialFormat).HasConversion<string>().HasMaxLength(16);
            user.Property(u => u.EncryptionMode).HasConversion<string>().HasMaxLength(16);
            user.Property(u => u.Preferences)
                .HasConversion(
                    preferences => JsonSerializer.Serialize(preferences, PreferencesJson),
                    json => ReadPreferences(json));
        });

        modelBuilder.Entity<Note>(note =>
        {
            note.ToTable("Notes");
            note.HasOne<User>().WithMany().HasForeignKey(n => n.UserId).OnDelete(DeleteBehavior.Cascade);

            // Serve keyset pagination (ORDER BY CreatedAtUtc DESC, Id DESC) over all of a user's notes (exports,
            // searches) and over one kind (the timeline and the Todo and Quick notes tabs).
            note.HasIndex(n => new { n.UserId, n.CreatedAtUtc, n.Id });
            note.HasIndex(n => new { n.UserId, n.Kind, n.CreatedAtUtc, n.Id });

            // Serves the feed and the pinned notes of a tab in order, and counting tags and labels, from the index alone:
            // each list's flags are equalities (IsPinned is compared with a parameter, see NoteService.LoadBatchAsync),
            // so no note is read just to be skipped. Without it, every pinned list and tag count read every note.
            note.HasIndex(n => new { n.UserId, n.Kind, n.IsPinned, n.ArchivedAtUtc, n.TrashedAtUtc, n.CreatedAtUtc, n.Id });
            note.Property(n => n.Kind).HasConversion<string>().HasMaxLength(16);

            // At most one daily note per account and day (SQLite treats NULLs as distinct, so other notes are free).
            note.HasIndex(n => new { n.UserId, n.DailyDate }).IsUnique();
            note.Property(n => n.Revision).IsConcurrencyToken();

            note.HasMany(n => n.Attachments).WithOne().HasForeignKey(a => a.NoteId).OnDelete(DeleteBehavior.Cascade);
            note.HasMany(n => n.Tags).WithMany().UsingEntity<Dictionary<string, object>>(
                "NoteTags",
                tag => tag.HasOne<Tag>().WithMany().HasForeignKey("TagId").OnDelete(DeleteBehavior.Cascade),
                owner => owner.HasOne<Note>().WithMany().HasForeignKey("NoteId").OnDelete(DeleteBehavior.Cascade),
                join => join.HasKey("NoteId", "TagId"));
            note.HasMany(n => n.Labels).WithMany().UsingEntity<Dictionary<string, object>>(
                "NoteLabels",
                label => label.HasOne<Label>().WithMany().HasForeignKey("LabelId").OnDelete(DeleteBehavior.Cascade),
                owner => owner.HasOne<Note>().WithMany().HasForeignKey("NoteId").OnDelete(DeleteBehavior.Cascade),
                join =>
                {
                    join.HasKey("NoteId", "LabelId");
                    join.HasIndex("LabelId"); // a label's notes, and its count
                });

            // Serves emptying the trash after 30 days: WHERE TrashedAtUtc < @cutoff.
            note.HasIndex(n => n.TrashedAtUtc);
        });

        modelBuilder.Entity<Attachment>(attachment =>
        {
            attachment.ToTable("Attachments");
            attachment.HasOne<User>().WithMany().HasForeignKey(a => a.UserId).OnDelete(DeleteBehavior.Cascade);
            attachment.Property(a => a.FileName).HasMaxLength(255);
            attachment.Property(a => a.ContentType).HasMaxLength(255);
            attachment.Property(a => a.StorageKey).HasMaxLength(64);
            attachment.HasIndex(a => a.StorageKey).IsUnique();
            attachment.Property(a => a.Revision).IsConcurrencyToken();

            // Serves the cleanup of uploads never linked to a note: WHERE NoteId IS NULL AND CreatedAtUtc < @cutoff.
            attachment.HasIndex(a => new { a.NoteId, a.CreatedAtUtc });
        });

        modelBuilder.Entity<Tag>(tag =>
        {
            tag.ToTable("Tags");
            tag.HasOne<User>().WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
            tag.Property(t => t.Name).HasMaxLength(64);
            tag.HasIndex(t => new { t.UserId, t.Name }).IsUnique();
            tag.Property(t => t.Token).HasMaxLength(22);
            tag.HasIndex(t => new { t.UserId, t.Token }).IsUnique();
        });

        modelBuilder.Entity<Label>(label =>
        {
            label.ToTable("Labels");
            label.HasOne<User>().WithMany().HasForeignKey(l => l.UserId).OnDelete(DeleteBehavior.Cascade);
            label.Property(l => l.Name).HasMaxLength(Label.MaxNameLength);
            label.Property(l => l.Color).HasMaxLength(16);
            label.HasIndex(l => new { l.UserId, l.CreatedAtUtc });
        });

        modelBuilder.Entity<InstanceSetting>(setting =>
        {
            setting.ToTable("InstanceSettings");
            setting.HasKey(s => s.Key);
            setting.Property(s => s.Key).HasMaxLength(100);
        });
    }

    /// <summary>Increments the concurrency token of every modified <see cref="IRevisioned"/> entity.</summary>
    private void BumpRevisions()
    {
        foreach (var entry in ChangeTracker.Entries<IRevisioned>().Where(e => e.State == EntityState.Modified))
        {
            entry.Entity.Revision++;
        }
    }

    /// <summary>Stores DateTime values as UTC and marks values read back as UTC.</summary>
    internal sealed class UtcDateTimeConverter() : ValueConverter<DateTime, DateTime>(
        value => value.Kind == DateTimeKind.Utc ? value : value.ToUniversalTime(),
        value => DateTime.SpecifyKind(value, DateTimeKind.Utc));

    private static UserPreferences ReadPreferences(string json) =>
        string.IsNullOrWhiteSpace(json)
            ? new UserPreferences()
            : JsonSerializer.Deserialize<UserPreferences>(json, PreferencesJson) ?? new UserPreferences();
}
