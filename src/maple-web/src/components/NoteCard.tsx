import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Archive,
  ArchiveRestore,
  CalendarCheck,
  CalendarX,
  CloudUpload,
  Copy,
  Home,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Tag,
  Trash2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { saveErrorMessage } from "../lib/apiError";
import { useDoubleTap } from "../lib/doubleTap";
import { formatAbsolute, formatRelative } from "../lib/format";
import { toggleTask } from "../lib/markdownEdit";
import { useNoteEditor } from "../lib/noteEditor";
import { usePreferences, useUpdatePreferences } from "../lib/preferences";
import { useAuthStatus } from "../lib/queries";
import { usePatchNote } from "../lib/queries";
import { splitTitle } from "../lib/titles";
import type { Note } from "../lib/types";
import { AttachmentGallery } from "./AttachmentGallery";
import { Composer } from "./Composer";
import { LabelChips, LabelPicker } from "./Labels";
import { LinkPreviews } from "./LinkPreviews";
import { Markdown } from "./Markdown";
import { useRemoveNote } from "./NoteRemoval";
import { useToast } from "./Toaster";
import { IconButton, cn } from "./ui";

export function MenuItem({
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

const same = (content: string) => content;

/**
 * One note in a list: rendered Markdown, attachments, labels, and an actions menu (pin, edit, labels, move between Home
 * and quick notes, archive, delete). Lists that mix kinds label todo lists and quick notes. Ticking a checkbox in the
 * note shows at once and is saved in the background (lib/noteEditor.ts); with Double-tap to edit on, double-tapping or
 * double-clicking the note opens it for editing. Deleting moves it to the trash, unless the trash is turned off.
 */
export function NoteCard({ note, showKind = true }: { note: Note; showKind?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [choosingLabels, setChoosingLabels] = useState(false);
  const patch = usePatchNote();
  const toast = useToast();
  const { noteTitles, quickNoteTitles, quickNotes, linkPreviews, archive, doubleTapToEdit, labels, dailyNotes, dailyNoteTemplate } =
    usePreferences();
  const updatePreferences = useUpdatePreferences();
  const isTemplate = note.id === dailyNoteTemplate;
  // A daily note cannot be the template of the others, and a note kept only on this device has no ID on the server yet.
  const canBeTemplate = dailyNotes && !note.dailyDate && !note.pending;
  const previewsAvailable = useAuthStatus().data?.linkPreviewsAvailable === true;
  const [content, commit] = useNoteEditor(note, same, same, (error) =>
    toast.error(saveErrorMessage(error, "A change to this note could not be saved. Please try again.")),
  );
  const doubleTap = useDoubleTap(() => setEditing(true));
  const removal = useRemoveNote(note, {
    noun: "note",
    confirmTitle: "Delete this note?",
    confirmDescription:
      note.attachments.length > 0
        ? `The note and its ${note.attachments.length} attached file(s) will be deleted permanently. To keep it out of sight instead, archive it.`
        : "The note will be deleted permanently. To keep it out of sight instead, archive it.",
  });
  const { title, body } = noteTitles ? splitTitle(content) : { title: "", body: content };
  const edited = new Date(note.updatedAtUtc).getTime() - new Date(note.createdAtUtc).getTime() > 60_000;

  function change(changes: { isPinned?: boolean; isArchived?: boolean; kind?: Note["kind"] }, message: string) {
    patch.mutate({ id: note.id, ...changes }, {
      onSuccess: () => toast.info(message),
      onError: () => toast.error("That didn't work. Please try again."),
    });
  }

  // The body is the end of the note's text, after any title, so its offsets are shifted by what comes before it.
  function toggleItem(offset: number) {
    const next = toggleTask(content, content.length - body.length + offset);
    if (next !== null) commit(next);
  }

  if (editing) {
    // Timeline notes get the title field, and quick notes when titles are on for them; todo lists are edited as they are.
    const allowTitle = note.kind === "Note" || (note.kind === "Quick" && quickNoteTitles);
    return <Composer note={{ ...note, content }} onDone={() => setEditing(false)} allowTitle={allowTitle} autoFocus />;
  }

  const tapToEdit = doubleTapToEdit && !note.isArchived;
  return (
    <article
      {...(tapToEdit ? doubleTap : {})}
      className={cn(
        "note-card rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900",
        tapToEdit && "touch-manipulation", // no double-tap zoom
      )}
    >
      <header className="-mt-1 mb-1 flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
        <time dateTime={note.createdAtUtc} title={formatAbsolute(note.createdAtUtc)}>
          {formatRelative(note.createdAtUtc)}
        </time>
        {edited && <span title={`Edited ${formatAbsolute(note.updatedAtUtc)}`}>· edited</span>}
        {showKind && note.kind !== "Note" && (
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            {note.kind === "Todo" ? "Todo list" : "Quick note"}
          </span>
        )}
        {note.pending && (
          <span
            className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"
            title="Kept on this device until the server can be reached."
          >
            <CloudUpload className="size-3.5" aria-hidden="true" /> Not saved yet
          </span>
        )}
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
                    {labels && (
                      <MenuItem icon={Tag} onSelect={() => setChoosingLabels(true)}>
                        Labels…
                      </MenuItem>
                    )}
                    {note.kind === "Quick" && (
                      <MenuItem icon={Home} onSelect={() => change({ kind: "Note" }, "Moved to Home.")}>
                        Move to Home
                      </MenuItem>
                    )}
                    {note.kind === "Note" && quickNotes && (
                      <MenuItem icon={Zap} onSelect={() => change({ kind: "Quick" }, "Moved to quick notes.")}>
                        Move to quick notes
                      </MenuItem>
                    )}
                  </>
                )}
                {(canBeTemplate || isTemplate) && (
                  <MenuItem
                    icon={isTemplate ? CalendarX : CalendarCheck}
                    onSelect={() =>
                      updatePreferences.mutate(
                        { dailyNoteTemplate: isTemplate ? "" : note.id },
                        {
                          onSuccess: () => toast.info(isTemplate ? "Daily notes start empty again." : "New daily notes start with this note's text."),
                          onError: () => toast.error("Could not save the setting."),
                        },
                      )
                    }
                  >
                    {isTemplate ? "Stop using as daily template" : "Use as daily-note template"}
                  </MenuItem>
                )}
                <MenuItem
                  icon={Copy}
                  onSelect={() =>
                    void navigator.clipboard
                      .writeText(content)
                      .then(() => toast.info("Copied to the clipboard."))
                      .catch(() => toast.error("Copying is not allowed here."))
                  }
                >
                  Copy text
                </MenuItem>
                {(archive || note.isArchived) && (
                  <MenuItem
                    icon={note.isArchived ? ArchiveRestore : Archive}
                    onSelect={() => change({ isArchived: !note.isArchived }, note.isArchived ? "Restored to your feed." : "Archived.")}
                  >
                    {note.isArchived ? "Restore" : "Archive"}
                  </MenuItem>
                )}
                <DropdownMenu.Separator className="my-1 h-px bg-stone-200 dark:bg-stone-700" />
                <MenuItem icon={Trash2} danger onSelect={removal.start}>
                  {removal.menuLabel}
                </MenuItem>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>

      {title && <h3 className="mb-1 break-words text-lg font-semibold leading-snug">{title}</h3>}
      {body.trim() && <Markdown content={body} onToggleTask={note.isArchived ? undefined : toggleItem} />}
      {linkPreviews && previewsAvailable && <LinkPreviews content={content} />}
      <AttachmentGallery attachments={note.attachments} />
      <LabelChips ids={note.labelIds} />

      {removal.dialog}
      {labels && <LabelPicker note={note} open={choosingLabels} onOpenChange={setChoosingLabels} />}
    </article>
  );
}
