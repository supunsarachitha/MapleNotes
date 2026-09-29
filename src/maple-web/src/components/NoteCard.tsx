import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Archive, ArchiveRestore, Copy, MoreHorizontal, Pencil, Pin, PinOff, Trash2, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { formatAbsolute, formatRelative } from "../lib/format";
import { useDeleteNote, usePatchNote } from "../lib/queries";
import type { Note } from "../lib/types";
import { AttachmentGallery } from "./AttachmentGallery";
import { Composer } from "./Composer";
import { ConfirmDialog } from "./ConfirmDialog";
import { Markdown } from "./Markdown";
import { useToast } from "./Toaster";
import { IconButton, cn } from "./ui";

function MenuItem({
  icon: Icon,
  children,
  onSelect,
  danger = false,
}: {
  icon: LucideIcon;
  children: string;
  onSelect: () => void;
  danger?: boolean;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-2.5 text-sm outline-none",
        danger
          ? "text-red-700 data-[highlighted]:bg-red-50 dark:text-red-400 dark:data-[highlighted]:bg-red-950"
          : "data-[highlighted]:bg-stone-100 dark:data-[highlighted]:bg-stone-800",
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {children}
    </DropdownMenu.Item>
  );
}

/** One note in a list: rendered Markdown, attachments, and an actions menu (pin, edit, archive, delete). */
export function NoteCard({ note }: { note: Note }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const patch = usePatchNote();
  const remove = useDeleteNote();
  const toast = useToast();
  const edited = new Date(note.updatedAtUtc).getTime() - new Date(note.createdAtUtc).getTime() > 60_000;

  function change(changes: { isPinned?: boolean; isArchived?: boolean }, message: string) {
    patch.mutate({ id: note.id, ...changes }, {
      onSuccess: () => toast.info(message),
      onError: () => toast.error("That didn't work. Please try again."),
    });
  }

  if (editing) {
    return <Composer note={note} onDone={() => setEditing(false)} autoFocus />;
  }

  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <header className="-mt-1 mb-1 flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
        <time dateTime={note.createdAtUtc} title={formatAbsolute(note.createdAtUtc)}>
          {formatRelative(note.createdAtUtc)}
        </time>
        {edited && <span title={`Edited ${formatAbsolute(note.updatedAtUtc)}`}>· edited</span>}
        {note.isPinned && !note.isArchived && (
          <span className="inline-flex items-center gap-1 text-maple-600 dark:text-maple-400">
            <Pin className="size-3.5" aria-hidden="true" /> Pinned
          </span>
        )}
        <div className="-mr-2 ml-auto">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <IconButton label="Note actions">
                <MoreHorizontal className="size-5" />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="z-50 min-w-48 rounded-xl border border-stone-200 bg-white p-1 text-stone-800 shadow-lg dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
              >
                {!note.isArchived && (
                  <>
                    <MenuItem icon={note.isPinned ? PinOff : Pin} onSelect={() => change({ isPinned: !note.isPinned }, note.isPinned ? "Unpinned." : "Pinned to the top.")}>
                      {note.isPinned ? "Unpin" : "Pin to top"}
                    </MenuItem>
                    <MenuItem icon={Pencil} onSelect={() => setEditing(true)}>
                      Edit
                    </MenuItem>
                  </>
                )}
                <MenuItem
                  icon={Copy}
                  onSelect={() =>
                    void navigator.clipboard
                      .writeText(note.content)
                      .then(() => toast.info("Copied to the clipboard."))
                      .catch(() => toast.error("Copying is not allowed here."))
                  }
                >
                  Copy text
                </MenuItem>
                <MenuItem
                  icon={note.isArchived ? ArchiveRestore : Archive}
                  onSelect={() => change({ isArchived: !note.isArchived }, note.isArchived ? "Restored to your feed." : "Archived.")}
                >
                  {note.isArchived ? "Restore" : "Archive"}
                </MenuItem>
                <DropdownMenu.Separator className="my-1 h-px bg-stone-200 dark:bg-stone-700" />
                <MenuItem icon={Trash2} danger onSelect={() => setConfirmDelete(true)}>
                  Delete…
                </MenuItem>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>

      {note.content.trim() && <Markdown content={note.content} />}
      <AttachmentGallery attachments={note.attachments} />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this note?"
        description={
          note.attachments.length > 0
            ? `The note and its ${note.attachments.length} attached file(s) will be deleted permanently. To keep it out of sight instead, archive it.`
            : "The note will be deleted permanently. To keep it out of sight instead, archive it."
        }
        confirmLabel="Delete"
        busy={remove.isPending}
        onConfirm={() =>
          remove.mutate(note.id, {
            onSuccess: () => {
              setConfirmDelete(false);
              toast.info("Note deleted.");
            },
            onError: () => toast.error("Could not delete the note."),
          })
        }
      />
    </article>
  );
}
