using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MapleNotes.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MoodsAndStickers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<byte[]>(
                name: "EncryptedMood",
                table: "Notes",
                type: "BLOB",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Mood",
                table: "Notes",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "IsSticker",
                table: "Attachments",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EncryptedMood",
                table: "Notes");

            migrationBuilder.DropColumn(
                name: "Mood",
                table: "Notes");

            migrationBuilder.DropColumn(
                name: "IsSticker",
                table: "Attachments");
        }
    }
}
