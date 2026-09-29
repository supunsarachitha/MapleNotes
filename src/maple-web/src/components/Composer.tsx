import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { Paperclip, X, FileText, AlertCircle } from "lucide-react";
import { api, ApiError, uploadAttachment } from "../lib/api";
import { AttachmentThumbnail } from "./AttachmentGallery";
import { formatDate } from "../lib/dates";
import { formatBytes } from "../lib/format";
import { usePreferences } from "../lib/preferences";
import { useInvalidateNotes } from "../lib/queries";
import { joinTitle, splitTitle } from "../lib/titles";
import type { Attachment, Note } from "../lib/types";
import { useToast } from "./Toaster";
import { Button, IconButton, cn } from "./ui";

const MAX_LENGTH = 100_000;

interface ComposerFile {
  key: string;
  name: string;
  size: number;
  isImage: boolean;
  previewUrl?: string;
  progress: number;
  attachment?: Attachment;
  error?: string;
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
    existing: true,
  };
}

/**
 * Writes a new note or edits an existing one. Files are uploaded as soon as they are chosen, pasted or dropped, so
 * posting is instant; the note only references their IDs. With note titles on, a title field is shown; the title is
 * saved as the note's first line, as a heading (see lib/titles.ts), and may start with today's date.
 */
export function Composer({
  note,
  onDone,
  autoFocus = false,
  allowTitle = true,
}: {
  /** The note to edit; omit to write a new note. */
  note?: Note;
  /** Called after a successful save, or when an edit is cancelled. */
  onDone?: () => void;
  autoFocus?: boolean;
  /** Offer the title field when the user has note titles on. */
  allowTitle?: boolean;
}) {
  const preferences = usePreferences();
  const withTitle = allowTitle && preferences.noteTitles;
  const suggestTitle = () => (!note && withTitle && preferences.dateInTitles ? formatDate(new Date(), preferences.dateFormat) : "");
  const [initial] = useState(() => (note && withTitle ? splitTitle(note.content) : { title: "", body: note?.content ?? "" }));
  const [suggested, setSuggested] = useState(suggestTitle);
  const [title, setTitle] = useState(() => initial.title || suggested);
  const [text, setText] = useState(initial.body);
  const [files, setFiles] = useState<ComposerFile[]>(() => note?.attachments.map(fromAttachment) ?? []);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const invalidateNotes = useInvalidateNotes();
  const toast = useToast();
  const editing = note !== undefined;

  // Grow the text box with its content, up to a comfortable maximum.
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 480)}px`;
  }, [text]);

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

  const uploading = files.some((f) => !f.attachment && !f.error);
  const attachmentIds = files.flatMap((f) => (f.attachment ? [f.attachment.id] : []));
  const content = withTitle ? joinTitle(title, text) : text;
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

      uploadAttachment(file, (progress) => update(key, { progress }), abort.signal)
        .then((attachment) => update(key, { attachment, progress: 1 }))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          update(key, { error: error instanceof ApiError ? error.message : "Upload failed." });
        });
    }
  }

  function removeFile(file: ComposerFile) {
    file.abort?.abort();
    if (file.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(file.previewUrl);
    setFiles((current) => current.filter((f) => f.key !== file.key));
    // New uploads are deleted right away; files already on the note are removed when the edit is saved.
    if (file.attachment && !file.existing) void api.deleteAttachment(file.attachment.id).catch(() => undefined);
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      if (editing) await api.updateNote(note.id, content, attachmentIds);
      else await api.createNote(content, attachmentIds);
      await invalidateNotes();
      if (!editing) {
        const next = suggestTitle();
        setSuggested(next);
        setTitle(next);
        setText("");
        setFiles([]);
      }
      onDone?.();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.fieldError("content") ?? error.message : "Could not save the note.");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    files.filter((f) => !f.existing).forEach(removeFile);
    onDone?.();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
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
      className={cn(
        "rounded-2xl border bg-white p-3 shadow-sm transition-colors dark:bg-stone-900",
        dragging ? "border-maple-500 ring-2 ring-maple-500/30" : "border-stone-200 dark:border-stone-800",
      )}
    >
      {withTitle && (
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={onTitleKeyDown}
          aria-label={editing ? "Edit title" : "Title"}
          placeholder="Title"
          maxLength={300}
          className="mb-1 block w-full border-b border-stone-100 bg-transparent px-1 pb-2 pt-1 text-base font-semibold text-stone-900 outline-none placeholder:font-normal placeholder:text-stone-400 dark:border-stone-800 dark:text-stone-100"
        />
      )}
      <label htmlFor={editing ? `edit-${note.id}` : "composer"} className="sr-only">
        {editing ? "Edit note" : "New note"}
      </label>
      <textarea
        id={editing ? `edit-${note.id}` : "composer"}
        ref={textarea}
        value={text}
        autoFocus={autoFocus}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        rows={editing ? 3 : 2}
        placeholder={editing ? undefined : "What's on your mind? Use #tags and **Markdown**."}
        className="block w-full resize-none bg-transparent px-1 py-1 text-base leading-relaxed text-stone-900 outline-none placeholder:text-stone-400 dark:text-stone-100"
      />

      {files.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attached files">
          {files.map((file) => (
            <li
              key={file.key}
              className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-800"
              title={`${file.name} (${formatBytes(file.size)})`}
            >
              {file.previewUrl ? (
                <img src={file.previewUrl} alt={file.name} className="size-full object-cover" />
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

      <div className="mt-2 flex items-center gap-2 border-t border-stone-100 pt-2 dark:border-stone-800">
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
        <IconButton label="Attach files" onClick={() => fileInput.current?.click()}>
          <Paperclip className="size-5" />
        </IconButton>
        {content.length > MAX_LENGTH * 0.9 && (
          <span className={cn("text-xs", content.length > MAX_LENGTH ? "text-red-700" : "text-stone-500")}>
            {content.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()}
          </span>
        )}
        <span className="hidden text-xs text-stone-400 sm:inline">Ctrl/⌘ + Enter to {editing ? "save" : "post"}</span>
        <div className="ml-auto flex gap-2">
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
  );
}
