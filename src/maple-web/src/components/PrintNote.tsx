import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatAbsolute } from "../lib/format";
import { useAttachmentSrc } from "../lib/mediaWorker";
import type { Attachment, Note } from "../lib/types";
import { Markdown } from "./Markdown";

/** Prints anyway after this long, if a picture never finishes loading. */
const PICTURE_WAIT_MS = 10_000;

function PrintImage({ image, onSettled }: { image: Attachment; onSettled: () => void }) {
  const src = useAttachmentSrc(image, { load: true });
  return src ? <img src={src} alt={image.fileName} onLoad={onSettled} onError={onSettled} /> : null;
}

/**
 * Only this note, laid out for paper: shown by the print rules in index.css while `body.printing-note` is set, and
 * hidden on screen. The browser's print dialog also offers to save it as a PDF.
 */
function PrintView({ note, title, body, onReady }: { note: Note; title: string; body: string; onReady: () => void }) {
  const pictures = note.attachments.filter((a) => a.isImage);
  const others = note.attachments.filter((a) => !a.isImage);
  const left = useRef(pictures.length);
  const ready = useRef(false);

  function settle() {
    left.current -= 1;
    if (left.current <= 0 && !ready.current) {
      ready.current = true;
      onReady();
    }
  }

  useEffect(() => {
    const finish = () => {
      if (ready.current) return;
      ready.current = true;
      onReady();
    };
    if (pictures.length === 0) {
      requestAnimationFrame(finish); // the text has rendered
      return;
    }
    const timer = setTimeout(finish, PICTURE_WAIT_MS);
    return () => clearTimeout(timer);
    // Runs once per print; the view is mounted afresh each time.
  }, []);

  return (
    <div id="print-note" data-note-text="medium">
      <p className="print-date">
        {formatAbsolute(note.createdAtUtc)}
        {new Date(note.updatedAtUtc).getTime() - new Date(note.createdAtUtc).getTime() > 60_000 &&
          ` · edited ${formatAbsolute(note.updatedAtUtc)}`}
      </p>
      {title && <h1 className="print-title">{title}</h1>}
      {body.trim() && <Markdown content={body} />}
      {pictures.length > 0 && (
        <div className="print-pictures">
          {pictures.map((image) => (
            <PrintImage key={image.id} image={image} onSettled={settle} />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <p className="print-files">Attached: {others.map((file) => file.fileName).join(", ")}</p>
      )}
    </div>
  );
}

/**
 * Printing one note: `start()` renders it into a print-only layer, waits for its pictures, and opens the print dialog.
 * The page title becomes the note's title meanwhile, which browsers suggest as the PDF's file name.
 */
export function usePrintNote(note: Note, title: string, body: string): { start: () => void; view: ReactNode } {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return;
    const pageTitle = document.title;
    const done = () => setPrinting(false);
    document.body.classList.add("printing-note");
    if (title) document.title = title;
    window.addEventListener("afterprint", done);
    return () => {
      window.removeEventListener("afterprint", done);
      document.body.classList.remove("printing-note");
      document.title = pageTitle;
    };
  }, [printing, title]);

  // The view stays until afterprint (sent by every current browser when the dialog closes): browsers whose print
  // dialog does not block the page are still printing it after print() returns.
  const ready = () => window.print();

  return {
    start: () => setPrinting(true),
    view: printing ? createPortal(<PrintView note={note} title={title} body={body} onReady={ready} />, document.body) : null,
  };
}
