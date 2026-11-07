import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { Paperclip, X, FileText, AlertCircle, Smile, Sticker as StickerIcon, Maximize2, Minimize2 } from "lucide-react";
import { useLeaveGuard } from "../lib/router";
import { api, ApiError, uploadAttachment } from "../lib/api";
import { AttachmentThumbnail } from "./AttachmentGallery";
import { applyFormat, FormatToolbar, shortcutFormat } from "./FormatToolbar";
import { calendarDay, formatDate } from "../lib/dates";
import { focusAtEnd } from "../lib/focus";
import { formatBytes } from "../lib/format";
import { usePreferences } from "../lib/preferences";
import { shrinkPhoto } from "../lib/shrinkPhoto";
import { useInvalidateNotes } from "../lib/queries";
import { saveDailyNote } from "../lib/daily";
import { joinTitle, splitTitle } from "../lib/titles";
import { StickerPackError, stickerFile, stickersAllowed, stickerFileName, type Sticker } from "../lib/stickers";
import { moodAllowed, type Attachment, type Note, type NoteKind, type NoteMood } from "../lib/types";
import { MOOD_EMOJI, MoodPicker } from "./MoodPicker";
import { StickerPicker } from "./StickerPicker";
import { useTagSuggestions } from "./TagSuggestions";
import { useToast } from "./Toaster";
import { Button, IconButton, cn } from "./ui";

const MAX_LENGTH = 100_000;

/** Words in a text, for the word count shown while writing. */
export function countWords(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

interface ComposerFile {
  key: string;
  name: string;
  size: number;
  isImage: boolean;
  previewUrl?: string;
  progress: number;
  attachment?: Attachment;
  error?: string;
  /** A sticker from a sticker pack: shown whole, not cropped. */
  sticker?: boolean;
  /** Already attached to the note being edited (so not deleted when the edit is cancelled). */
  existing: boolean;
  abort?: AbortController;
}

let nextKey = 1;

function fromAttachment(attachment: Attachment): ComposerFile {
  return {
    key: `existing-${attachment.id}`,
    name: attachment.fileName,
    size: attachment.sizeBytes,
    isImage: attachment.isImage,
    // End-to-end images are decrypted by <AttachmentThumbnail>; plain ones load straight from their URL.
    previewUrl: attachment.isImage && !attachment.endToEnd ? attachment.url : undefined,
    progress: 1,
    attachment,
    sticker: attachment.isSticker === true,
    existing: true,
  };
}

/**
 * Writes a new note or edits an existing one. Files are uploaded as soon as they are chosen, pasted or dropped, so
 * posting is instant; the note only references their IDs. With note titles on, a title field is shown; the title is
 * saved as the note's first line, as a heading (see lib/titles.ts), and may start with today's date. Editing starts
 * with the caret at the end of the text, and with tag suggestions on, existing tags are offered while a #tag is typed.
 * With the mood tracker on, a smiley button chooses the note's mood; with stickers on, a sticker button adds stickers
 * from the packs in this browser (notes and quick notes only, as in Falcon Notes). A collapsible composer shows one
 * line while it is empty and unfocused, and opens the full editor when it gets focus.
 */
export function Composer({
  note,
  onDone,
  autoFocus = false,
  allowTitle = true,
  kind = "Note",
  placeholder = "What's on your mind? Use #tags and **Markdown**.",
  daily,
  initialText = "",
  collapsible = false,
}: {
  /** The note to edit; omit to write a new note. */
  note?: Note;
  /** Called after a successful save, or when an edit is cancelled. */
  onDone?: () => void;
  autoFocus?: boolean;
  /** Offer the title field when the user has note titles on. */
  allowTitle?: boolean;
  /** The kind of note a new note becomes. */
  kind?: NoteKind;
  placeholder?: string;
  /** Starts a day's daily note: the title is the date and cannot be changed here. */
  daily?: { date: string; title: string };
  /** The text a new note starts with, such as the daily-note template. */
  initialText?: string;
  /** While empty and unfocused, show a single line (placeholder, attach, full screen) instead of the full editor. */
  collapsible?: boolean;
}) {
  const preferences = usePreferences();
  const withTitle = allowTitle && preferences.noteTitles && !daily;
  const suggestTitle = () => (!note && withTitle && preferences.dateInTitles ? formatDate(calendarDay(), preferences.dateFormat) : "");
  const [initial] = useState(() => (note && withTitle ? splitTitle(note.content) : { title: "", body: note?.content ?? initialText }));
  const [suggested, setSuggested] = useState(suggestTitle);
  const [title, setTitle] = useState(() => initial.title || suggested);
  const [text, setText] = useState(initial.body);
  const [files, setFiles] = useState<ComposerFile[]>(() => note?.attachments.map(fromAttachment) ?? []);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [mood, setMood] = useState<NoteMood | null>(note?.mood ?? null);
  const [picker, setPicker] = useState<"mood" | "stickers" | null>(null);
  const [fullscreen, setFullscreen] = useState(() => note !== undefined && preferences.openFullScreen);
  const [focused, setFocused] = useState(false);
  // New-note boxes open full screen when focused; armed again once focus leaves, so Esc does not reopen it at once.
  const armed = useRef(true);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const invalidateNotes = useInvalidateNotes();
  const toast = useToast();
  const suggestions = useTagSuggestions(textarea, setText, preferences.tagSuggestions);
  const editing = note !== undefined;
  const noteKind = note?.kind ?? kind;
  const offersMood = preferences.moodTracker && moodAllowed(noteKind);
  const offersStickers = preferences.stickers && stickersAllowed(noteKind);
  const pickerId = editing ? `edit-${note.id}` : "composer";
  // A collapsible box stays one line until it gets focus or holds anything: text, a typed title, files or a mood.
  const collapsed =
    collapsible && !editing && !fullscreen && !focused && !dragging && picker === null && mood === null && files.length === 0 &&
    text.trim().length === 0 && (!withTitle || title.trim() === suggested.trim());
  // One line has room for the placeholder's first sentence only.
  const shortPlaceholder = placeholder.split(/(?<=[.?!…])\s/)[0];

  // Grow the text box with its content, up to a comfortable maximum.
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    if (fullscreen) {
      element.style.height = "";
      return;
    }
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 480)}px`;
  }, [text, fullscreen, collapsed]);

  // Full screen: the page behind does not scroll, and the caret stays in the text.
  useEffect(() => {
    if (!fullscreen) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    textarea.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [fullscreen]);

  // Opened for writing: the caret goes after the text, where one carries on, once the box has grown to fit it.
  useEffect(() => {
    if (autoFocus) focusAtEnd(textarea.current);
    // Only when the composer opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Release the object URLs used for local image previews when the composer goes away.
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(
    () => () =>
      filesRef.current.forEach((f) => {
        if (f.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(f.previewUrl);
      }),
    [],
  );

  const words = countWords(withTitle ? `${title} ${text}` : text);
  const uploading = files.some((f) => !f.attachment && !f.error);
  const attachmentIds = files.flatMap((f) => (f.attachment ? [f.attachment.id] : []));
  const content = daily ? joinTitle(daily.title, text) : withTitle ? joinTitle(title, text) : text;
  // A title only counts as something written when the user typed it, not when it is just today's date.
  const typedTitle = withTitle && title.trim().length > 0 && title.trim() !== suggested.trim();
  const canSave =
    !saving && !uploading && content.length <= MAX_LENGTH && (text.trim().length > 0 || attachmentIds.length > 0 || typedTitle);

  function update(key: string, changes: Partial<ComposerFile>) {
    setFiles((current) => current.map((f) => (f.key === key ? { ...f, ...changes } : f)));
  }

  function addFiles(list: FileList | File[]) {
    for (const file of Array.from(list)) {
      const key = `new-${nextKey++}`;
      const isImage = file.type.startsWith("image/") && file.type !== "image/svg+xml";
      const abort = new AbortController();
      setFiles((current) => [
        ...current,
        {
          key,
          name: file.name || "pasted-image.png",
          size: file.size,
          isImage,
          previewUrl: isImage ? URL.createObjectURL(file) : undefined,
          progress: 0,
          existing: false,
          abort,
        },
      ]);

      const send = async () => {
        const upload = preferences.shrinkPhotos ? await shrinkPhoto(file, preferences.photoSize) : file;
        if (upload !== file) update(key, { name: upload.name, size: upload.size });
        abort.signal.throwIfAborted(); // removed while it was being shrunk
        return uploadAttachment(upload, (progress) => update(key, { progress }), abort.signal);
      };
      send()
        .then((attachment) => update(key, { attachment, progress: 1 }))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          update(key, { error: error instanceof ApiError ? error.message : "Upload failed." });
        });
    }
  }

  // The picture is copied from its pack into the note's files, so the note keeps it if the pack is removed.
  function addSticker(sticker: Sticker) {
    const key = `new-${nextKey++}`;
    const abort = new AbortController();
    setFiles((current) => [
      ...current,
      { key, name: stickerFileName(sticker), size: 0, isImage: true, sticker: true, progress: 0, existing: false, abort },
    ]);
    const send = async () => {
      const file = await stickerFile(sticker);
      if (!file) throw new StickerPackError("This sticker's pack was removed.");
      update(key, { size: file.size, previewUrl: URL.createObjectURL(file) });
      abort.signal.throwIfAborted();
      return uploadAttachment(file, (progress) => update(key, { progress }), abort.signal, { sticker: true });
    };
    send()
      .then((attachment) => update(key, { attachment, progress: 1 }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        update(key, { error: error instanceof ApiError || error instanceof StickerPackError ? error.message : "Could not add this sticker." });
      });
  }

  function removeFile(file: ComposerFile) {
    file.abort?.abort();
    if (file.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(file.previewUrl);
    setFiles((current) => current.filter((f) => f.key !== file.key));
    // New uploads are deleted right away; files already on the note are removed when the edit is saved.
    if (file.attachment && !file.existing) void api.deleteAttachment(file.attachment.id).catch(() => undefined);
  }

  async function save(): Promise<boolean> {
    if (!canSave) return false;
    setSaving(true);
    try {
      // Without the mood tracker, an edit keeps the note's mood as it is.
      const chosen = offersMood ? mood : undefined;
      if (editing) {
        if (chosen === undefined) await api.updateNote(note.id, content, attachmentIds, note);
        else await api.updateNote(note.id, content, attachmentIds, note, chosen);
      } else if (daily) await saveDailyNote(daily.date, daily.title, text, attachmentIds, chosen ?? undefined);
      else {
        const options = { ...(kind === "Note" ? {} : { kind }), ...(chosen ? { mood: chosen } : {}) };
        if (Object.keys(options).length > 0) await api.createNote(content, attachmentIds, options);
        else await api.createNote(content, attachmentIds);
      }
      await invalidateNotes();
      if (!editing) {
        const next = suggestTitle();
        setSuggested(next);
        setTitle(next);
        setText("");
        setFiles([]);
        setMood(null);
        setPicker(null);
      }
      setFullscreen(false);
      onDone?.();
      return true;
    } catch (error) {
      toast.error(error instanceof ApiError ? error.fieldError("content") ?? error.message : "Could not save the note.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    files.filter((f) => !f.existing).forEach(removeFile);
    onDone?.();
  }

  // Unsaved: an edit that differs from the note (text, files or mood), or a new note with anything in it. Leaving the
  // page then asks first (lib/router.tsx, LeaveDialog).
  const sameFiles = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
  const dirty = editing
    ? content !== note.content ||
      !sameFiles(files.map((f) => f.attachment?.id ?? f.key), note.attachments.map((a) => a.id)) ||
      (offersMood && mood !== (note.mood ?? null))
    : text.trim().length > 0 || typedTitle || files.length > 0 || mood !== null;
  useLeaveGuard({
    dirty: () => dirty && !saving,
    save: async () => {
      if (uploading) {
        toast.error("Wait for the files to finish uploading, then try again.");
        return false;
      }
      if (!canSave && editing && content.trim().length === 0 && attachmentIds.length === 0) {
        toast.error("An empty note cannot be saved. Delete it instead, or discard the change.");
        return false;
      }
      return save();
    },
    discard: () => {
      if (editing) {
        cancel();
        return;
      }
      files.forEach(removeFile);
      setText(initialText);
      setTitle(suggested);
      setMood(null);
      setPicker(null);
      setFullscreen(false);
    },
  });

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.onKeyDown(event)) return;
    const format = shortcutFormat(event);
    if (format) {
      event.preventDefault();
      applyFormat(event.currentTarget, format, setText);
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    } else if (event.key.toLowerCase() === "f" && event.shiftKey && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      setFullscreen((open) => !open);
    } else if (event.key === "Escape" && fullscreen) {
      event.preventDefault();
      setFullscreen(false);
    } else if (event.key === "Escape" && editing) {
      event.preventDefault();
      cancel();
    }
  }

  function onTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    } else if (event.key === "Enter") {
      event.preventDefault();
      textarea.current?.focus();
    } else if (event.key === "Escape" && fullscreen) {
      event.preventDefault();
      setFullscreen(false);
    } else if (event.key === "Escape" && editing) {
      event.preventDefault();
      cancel();
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (event.clipboardData.files.length > 0) {
      event.preventDefault();
      addFiles(event.clipboardData.files);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={(event) => {
        if (collapsed && event.target === event.currentTarget) textarea.current?.focus();
      }}
      onFocus={() => {
        setFocused(true);
        if (editing || !preferences.openFullScreen || !armed.current) return;
        armed.current = false;
        setFullscreen(true);
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        armed.current = true;
        setFocused(false);
      }}
      role={fullscreen ? "dialog" : undefined}
      aria-modal={fullscreen || undefined}
      aria-label={fullscreen ? (editing ? "Edit note, full screen" : "New note, full screen") : undefined}
      className={cn(
        "transition-colors",
        fullscreen
          ? "fixed inset-0 z-50 flex flex-col overflow-y-auto bg-stone-50 px-4 py-6 sm:px-8 sm:py-10 dark:bg-stone-950"
          : "rounded-2xl border bg-white shadow-sm focus-within:border-maple-400 focus-within:shadow-md dark:bg-stone-900 dark:focus-within:border-maple-600",
        !fullscreen && (collapsed ? "cursor-text py-1.5 pl-3 pr-1.5" : "p-3"),
        !fullscreen && (dragging ? "border-maple-500 ring-2 ring-maple-500/30" : "border-stone-200 dark:border-stone-800"),
        fullscreen && dragging && "ring-4 ring-inset ring-maple-500/40",
      )}
    >
      <div className={cn(fullscreen && "mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col")}>
      {daily && <p className={cn("mb-1 border-b border-stone-100 px-1 pb-2 pt-1 font-semibold dark:border-stone-800", fullscreen ? "text-2xl sm:text-3xl" : "text-base")}>{daily.title}</p>}
      {withTitle && (
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={onTitleKeyDown}
          aria-label={editing ? "Edit title" : "Title"}
          placeholder="Title"
          maxLength={300}
          className={cn(
            "mb-1 block w-full border-b border-stone-100 bg-transparent px-1 pb-2 pt-1 font-semibold text-stone-900 outline-none",
            "placeholder:font-normal placeholder:text-stone-400 dark:border-stone-800 dark:text-stone-100",
            fullscreen ? "pb-3 text-2xl sm:text-3xl" : "text-base",
            collapsed && "hidden",
          )}
        />
      )}
      <label htmlFor={editing ? `edit-${note.id}` : "composer"} className="sr-only">
        {editing ? "Edit note" : "New note"}
      </label>
      <div className={cn(collapsed && "hidden")}>
      <FormatToolbar target={textarea} onChange={setText}>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        {offersStickers && (
          <IconButton
            label="Stickers"
            aria-expanded={picker === "stickers"}
            aria-controls={`${pickerId}-stickers`}
            onClick={() => setPicker((open) => (open === "stickers" ? null : "stickers"))}
          >
            <StickerIcon className="size-5" />
          </IconButton>
        )}
        {offersMood && (
          <IconButton
            label={mood ? `Mood: ${mood}` : "Mood"}
            aria-expanded={picker === "mood"}
            aria-controls={`${pickerId}-mood`}
            onClick={() => setPicker((open) => (open === "mood" ? null : "mood"))}
          >
            {mood ? (
              <span aria-hidden="true" className="text-xl leading-none">
                {MOOD_EMOJI[mood]}
              </span>
            ) : (
              <Smile className="size-5" />
            )}
          </IconButton>
        )}
        <IconButton label="Attach files" onClick={() => fileInput.current?.click()}>
          <Paperclip className="size-5" />
        </IconButton>
      </FormatToolbar>
      </div>

      {offersMood && picker === "mood" && (
        <MoodPicker
          id={`${pickerId}-mood`}
          value={mood}
          onChange={(next) => {
            setMood(next);
            setPicker(null);
          }}
        />
      )}
      {offersStickers && picker === "stickers" && <StickerPicker id={`${pickerId}-stickers`} onChoose={addSticker} />}

      <div className={cn("relative", fullscreen && "flex min-h-0 flex-1 flex-col", collapsed && "flex items-center gap-0.5")}>
        <textarea
          id={editing ? `edit-${note.id}` : "composer"}
          ref={textarea}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            suggestions.update();
          }}
          onSelect={suggestions.update}
          onBlur={suggestions.close}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={collapsed ? 1 : editing ? 3 : 2}
          wrap={collapsed ? "off" : undefined}
          placeholder={editing ? undefined : collapsed ? shortPlaceholder : placeholder}
          {...suggestions.inputProps}
          className={cn(
            "block w-full resize-none bg-transparent px-1 py-1 leading-relaxed text-stone-900 outline-none placeholder:text-stone-400 dark:text-stone-100",
            fullscreen ? "min-h-[40vh] flex-1 py-4 font-serif text-lg sm:text-xl sm:leading-loose" : "text-(length:--note-input)",
            collapsed && "min-w-0 flex-1 overflow-hidden",
          )}
        />
        {collapsed && (
          // These buttons must not take focus on press: focus opens the full editor, which removes them before the click.
          <>
            <IconButton label="Attach files" onMouseDown={(event) => event.preventDefault()} onClick={() => fileInput.current?.click()}>
              <Paperclip className="size-5" />
            </IconButton>
            <IconButton label="Full screen (Ctrl/⌘ + Shift + F)" onMouseDown={(event) => event.preventDefault()} onClick={() => setFullscreen(true)}>
              <Maximize2 className="size-5" />
            </IconButton>
          </>
        )}
        {suggestions.popup}
      </div>

      {files.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attached files">
          {files.map((file) => (
            <li
              key={file.key}
              className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-800"
              title={`${file.name} (${formatBytes(file.size)})`}
            >
              {file.previewUrl ? (
                <img src={file.previewUrl} alt={file.name} className={file.sticker ? "size-full object-contain p-1" : "size-full object-cover"} />
              ) : file.attachment?.endToEnd && file.attachment.isImage ? (
                <AttachmentThumbnail attachment={file.attachment} />
              ) : (
                <div className="flex flex-col items-center gap-1 px-1 text-center">
                  <FileText className="size-5 text-maple-600 dark:text-maple-400" aria-hidden="true" />
                  <span className="line-clamp-2 break-all text-[10px] leading-tight text-stone-600 dark:text-stone-300">{file.name}</span>
                </div>
              )}

              {!file.attachment && !file.error && (
                <div className="absolute inset-x-1 bottom-1 h-1.5 overflow-hidden rounded-full bg-black/20">
                  <div className="h-full bg-maple-500 transition-[width]" style={{ width: `${Math.round(file.progress * 100)}%` }} />
                </div>
              )}
              {file.error && (
                <div className="absolute inset-0 flex items-center justify-center bg-red-900/80 p-1" title={file.error}>
                  <AlertCircle className="size-5 text-white" aria-label={`Upload failed: ${file.error}`} />
                </div>
              )}

              <button
                type="button"
                onClick={() => removeFile(file)}
                aria-label={`Remove ${file.name}`}
                className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={cn("mt-2 flex items-center gap-2 border-t border-stone-100 pt-2 dark:border-stone-800", collapsed && "hidden")}>
        {content.length > MAX_LENGTH * 0.9 && (
          <span className={cn("text-xs", content.length > MAX_LENGTH ? "text-red-700" : "text-stone-500")}>
            {content.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()}
          </span>
        )}
        {words > 0 && (
          <span className="text-xs tabular-nums text-stone-500 dark:text-stone-400" aria-live="polite">
            {words.toLocaleString()} {words === 1 ? "word" : "words"}
            {fullscreen && ` · ${Math.max(1, Math.round(words / 200))} min read`}
          </span>
        )}
        <span className="hidden text-xs text-stone-400 md:inline">Ctrl/⌘ + Enter to {editing ? "save" : "post"}</span>
        <div className="ml-auto flex items-center gap-2">
          <IconButton
            label={fullscreen ? "Exit full screen (Esc)" : "Full screen (Ctrl/⌘ + Shift + F)"}
            aria-pressed={fullscreen}
            onClick={() => setFullscreen((open) => !open)}
          >
            {fullscreen ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
          </IconButton>
          {editing && (
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          )}
          <Button onClick={() => void save()} disabled={!canSave} busy={saving}>
            {editing ? "Save" : "Post"}
          </Button>
        </div>
      </div>
      </div>
    </div>
  );
}
