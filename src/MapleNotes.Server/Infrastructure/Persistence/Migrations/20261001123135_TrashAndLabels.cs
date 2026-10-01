using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MapleNotes.Server.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class TrashAndLabels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "TrashedAtUtc",
                table: "Notes",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Labels",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    UserId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 40, nullable: true),
                    EncryptedName = table.Column<byte[]>(type: "BLOB", nullable: true),
                    Color = table.Column<string>(type: "TEXT", maxLength: 16, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Labels", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Labels_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NoteLabels",
                columns: table => new
                {
                    NoteId = table.Column<Guid>(type: "TEXT", nullable: false),
                    LabelId = table.Column<Guid>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoteLabels", x => new { x.NoteId, x.LabelId });
                    table.ForeignKey(
                        name: "FK_NoteLabels_Labels_LabelId",
                        column: x => x.LabelId,
                        principalTable: "Labels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_NoteLabels_Notes_NoteId",
                        column: x => x.NoteId,
                        principalTable: "Notes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Notes_TrashedAtUtc",
                table: "Notes",
                column: "TrashedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_Notes_UserId_Kind_IsPinned_ArchivedAtUtc_TrashedAtUtc_CreatedAtUtc_Id",
                table: "Notes",
                columns: new[] { "UserId", "Kind", "IsPinned", "ArchivedAtUtc", "TrashedAtUtc", "CreatedAtUtc", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Labels_UserId_CreatedAtUtc",
                table: "Labels",
                columns: new[] { "UserId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_NoteLabels_LabelId",
                table: "NoteLabels",
                column: "LabelId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NoteLabels");

            migrationBuilder.DropTable(
                name: "Labels");

            migrationBuilder.DropIndex(
                name: "IX_Notes_TrashedAtUtc",
                table: "Notes");

            migrationBuilder.DropIndex(
                name: "IX_Notes_UserId_Kind_IsPinned_ArchivedAtUtc_TrashedAtUtc_CreatedAtUtc_Id",
                table: "Notes");

            migrationBuilder.DropColumn(
                name: "TrashedAtUtc",
                table: "Notes");
        }
    }
}
