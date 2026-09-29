using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MapleNotes.Server.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Key-derived sign-in (version 1.1). Existing accounts keep their password hash, marked as
    /// <c>LegacyPassword</c>, and get the default Argon2id parameters with a random salt of their own; each is
    /// upgraded at its owner's next sign-in (docs/e2ee-spec.md §1).
    /// </summary>
    public partial class KeyDerivedSignIn : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "PasswordHash",
                table: "Users",
                newName: "CredentialHash");

            migrationBuilder.AddColumn<string>(
                name: "CredentialFormat",
                table: "Users",
                type: "TEXT",
                maxLength: 16,
                nullable: false,
                defaultValue: "LegacyPassword");

            migrationBuilder.AddColumn<int>(
                name: "KdfIterations",
                table: "Users",
                type: "INTEGER",
                nullable: false,
                defaultValue: 3);

            migrationBuilder.AddColumn<int>(
                name: "KdfMemoryKiB",
                table: "Users",
                type: "INTEGER",
                nullable: false,
                defaultValue: 65536);

            migrationBuilder.AddColumn<int>(
                name: "KdfParallelism",
                table: "Users",
                type: "INTEGER",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<byte[]>(
                name: "KdfSalt",
                table: "Users",
                type: "BLOB",
                nullable: false,
                defaultValue: new byte[0]);

            // SQLite cannot add a column with a non-constant default, so the per-account salts are filled in here.
            // randomblob() draws from SQLite's CSPRNG, seeded by the operating system; a salt must be unique, not
            // secret.
            migrationBuilder.Sql("UPDATE \"Users\" SET \"KdfSalt\" = randomblob(16);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CredentialFormat",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "KdfIterations",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "KdfMemoryKiB",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "KdfParallelism",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "KdfSalt",
                table: "Users");

            migrationBuilder.RenameColumn(
                name: "CredentialHash",
                table: "Users",
                newName: "PasswordHash");
        }
    }
}
