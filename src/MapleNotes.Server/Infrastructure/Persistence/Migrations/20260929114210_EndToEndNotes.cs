using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MapleNotes.Server.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// End-to-end encrypted tags (version 1.1): a tag has either a name (plain-text notes) or a blind token with an
    /// encrypted name (end-to-end notes), each unique per user.
    /// </summary>
    public partial class EndToEndNotes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Name",
                table: "Tags",
                type: "TEXT",
                maxLength: 64,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldMaxLength: 64);

            migrationBuilder.AddColumn<byte[]>(
                name: "EncryptedName",
                table: "Tags",
                type: "BLOB",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Token",
                table: "Tags",
                type: "TEXT",
                maxLength: 22,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Tags_UserId_Token",
                table: "Tags",
                columns: new[] { "UserId", "Token" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Tags_UserId_Token",
                table: "Tags");

            migrationBuilder.DropColumn(
                name: "EncryptedName",
                table: "Tags");

            migrationBuilder.DropColumn(
                name: "Token",
                table: "Tags");

            migrationBuilder.AlterColumn<string>(
                name: "Name",
                table: "Tags",
                type: "TEXT",
                maxLength: 64,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldMaxLength: 64,
                oldNullable: true);
        }
    }
}
