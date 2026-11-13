using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MapleNotes.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class KnownDevices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "NewDevice",
                table: "Sessions",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "KnownDevices",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Device = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    Network = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    FirstSeenAtUtc = table.Column<DateTime>(type: "TEXT", nullable: false),
                    LastSeenAtUtc = table.Column<DateTime>(type: "TEXT", nullable: false),
                    NoticePending = table.Column<bool>(type: "INTEGER", nullable: false),
                    NoticeSessionId = table.Column<Guid>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_KnownDevices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_KnownDevices_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_KnownDevices_UserId_Device_Network",
                table: "KnownDevices",
                columns: new[] { "UserId", "Device", "Network" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "KnownDevices");

            migrationBuilder.DropColumn(
                name: "NewDevice",
                table: "Sessions");
        }
    }
}
