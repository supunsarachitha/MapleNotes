using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MapleNotes.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class NoteKinds : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Kind",
                table: "Notes",
                type: "TEXT",
                maxLength: 16,
                nullable: false,
                defaultValue: "Note"); // every existing note belongs to the timeline

            migrationBuilder.CreateIndex(
                name: "IX_Notes_UserId_Kind_CreatedAtUtc_Id",
                table: "Notes",
                columns: new[] { "UserId", "Kind", "CreatedAtUtc", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Notes_UserId_Kind_CreatedAtUtc_Id",
                table: "Notes");

            migrationBuilder.DropColumn(
                name: "Kind",
                table: "Notes");
        }
    }
}
