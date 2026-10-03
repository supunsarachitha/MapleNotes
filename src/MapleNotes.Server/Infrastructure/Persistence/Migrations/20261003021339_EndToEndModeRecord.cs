using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MapleNotes.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class EndToEndModeRecord : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<byte[]>(
                name: "E2eeModeRecord",
                table: "Users",
                type: "BLOB",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "E2eeModeRecord",
                table: "Users");
        }
    }
}
