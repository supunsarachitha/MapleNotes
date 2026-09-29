using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MapleNotes.Server.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Three encryption modes (version 1.1): the account flag becomes a mode (off, at rest, end-to-end), each note and
    /// attachment records its own scheme, and accounts get columns for their end-to-end key material. The server-held
    /// data key becomes optional, since an end-to-end account eventually has none.
    /// </summary>
    public partial class EncryptionModes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Account mode from the 1.0 flag: encryption at rest on or off. Converted before the flag is dropped.
            migrationBuilder.AddColumn<string>(
                name: "EncryptionMode",
                table: "Users",
                type: "TEXT",
                maxLength: 16,
                nullable: false,
                defaultValue: "Off");

            migrationBuilder.Sql(
                "UPDATE \"Users\" SET \"EncryptionMode\" = CASE WHEN \"EncryptionEnabled\" THEN 'AtRest' ELSE 'Off' END;");

            migrationBuilder.DropColumn(
                name: "EncryptionEnabled",
                table: "Users");

            // Per-item scheme from the 1.0 flag: false (0) is None and true (1) is Server, so a rename keeps the values.
            migrationBuilder.RenameColumn(
                name: "IsEncrypted",
                table: "Notes",
                newName: "Scheme");

            migrationBuilder.RenameColumn(
                name: "IsEncrypted",
                table: "Attachments",
                newName: "Scheme");

            migrationBuilder.AlterColumn<byte[]>(
                name: "WrappedDataKey",
                table: "Users",
                type: "BLOB",
                nullable: true,
                oldClrType: typeof(byte[]),
                oldType: "BLOB");

            migrationBuilder.AddColumn<byte[]>(
                name: "E2eeRecoveryWrappedKey",
                table: "Users",
                type: "BLOB",
                nullable: true);

            migrationBuilder.AddColumn<byte[]>(
                name: "E2eeWrappedKey",
                table: "Users",
                type: "BLOB",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RecoveryKeyHash",
                table: "Users",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Version 1.0 knows no end-to-end encryption; its content cannot be read after a rollback.
            migrationBuilder.AddColumn<bool>(
                name: "EncryptionEnabled",
                table: "Users",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.Sql("UPDATE \"Users\" SET \"EncryptionEnabled\" = \"EncryptionMode\" <> 'Off';");

            migrationBuilder.DropColumn(
                name: "E2eeRecoveryWrappedKey",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "E2eeWrappedKey",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "EncryptionMode",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "RecoveryKeyHash",
                table: "Users");

            migrationBuilder.RenameColumn(
                name: "Scheme",
                table: "Notes",
                newName: "IsEncrypted");

            migrationBuilder.RenameColumn(
                name: "Scheme",
                table: "Attachments",
                newName: "IsEncrypted");

            migrationBuilder.AlterColumn<byte[]>(
                name: "WrappedDataKey",
                table: "Users",
                type: "BLOB",
                nullable: false,
                defaultValue: new byte[0],
                oldClrType: typeof(byte[]),
                oldType: "BLOB",
                oldNullable: true);
        }
    }
}
