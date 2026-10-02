import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { runImport, type ImportProgress } from "../import/importer";
import { IMPORT_ACCEPT, readImport, type ImportPlan } from "../import/parse";
import { useInvalidateNotes } from "../lib/queries";
import { Button } from "./ui";

type Step =
  | { name: "idle" }
  | { name: "reading" }
  | { name: "ready"; plan: ImportPlan; label: string }
  | { name: "running" | "done"; plan: ImportPlan; progress: ImportProgress };

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

/**
 * Restores notes from Maple Notes exports (.zip, any format) or single .md, .txt and .json files. Notes keep their IDs,
 * dates, state and files; notes the account already has are skipped, so restoring twice is safe. Works for every
 * account: end-to-end accounts encrypt everything in this browser before it is sent.
 */
export function RestorePanel({ endToEnd }: { endToEnd: boolean }) {
  const [step, setStep] = useState<Step>({ name: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const invalidate = useInvalidateNotes();

  async function choose(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setStep({ name: "reading" });
    const plan = await readImport(list);
    setStep({
      name: "ready",
      plan,
      label: list.length === 1 ? list[0]!.name : plural(list.length, "file"),
    });
  }

  async function restore(plan: ImportPlan) {
    const final = await runImport(
      plan.items,
      (progress) => setStep({ name: "running", plan, progress }),
      undefined,
      plan.labelColors,
    );
    setStep({ name: "done", plan, progress: final });
    await invalidate();
  }

  const files =
    step.name === "ready"
      ? step.plan.items.reduce((sum, item) => sum + item.attachments.length, 0)
      : 0;
  const busy = step.name === "reading" || step.name === "running";

  return (
    <section
      aria-labelledby="restore-heading"
      className="mt-6 border-t border-stone-100 pt-5 dark:border-stone-800"
    >
      <h3 id="restore-heading" className="text-sm font-semibold">
        Restore
      </h3>
      <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
        Bring notes back from a Maple Notes export (<code>.zip</code>, any
        format), or add <code>.md</code>, <code>.txt</code> and{" "}
        <code>.json</code> files. Notes keep their dates, pins, archive state,
        labels and files. Notes you already have are skipped, so restoring the same
        export twice is safe.
        {endToEnd &&
          " Your notes are end-to-end encrypted, so this browser encrypts each one before sending it: keep this page open until it finishes."}
      </p>

      <input
        ref={input}
        type="file"
        multiple
        accept={IMPORT_ACCEPT}
        aria-label="Files to restore"
        className="hidden"
        onChange={(event) => {
          void choose(event.target.files);
          event.target.value = "";
        }}
      />

      {(step.name === "idle" ||
        step.name === "reading" ||
        step.name === "done") && (
        <Button
          variant="secondary"
          className="mt-4"
          busy={step.name === "reading"}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Upload className="size-4" aria-hidden="true" /> Choose files…
        </Button>
      )}

      {step.name === "ready" && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm">
            <strong>{step.label}</strong>:{" "}
            {plural(step.plan.items.length, "note")}
            {files > 0 && ` with ${plural(files, "attached file")}`}.
          </p>
          {step.plan.problems.length > 0 && (
            <ProblemList
              title="Some files could not be read:"
              items={step.plan.problems}
            />
          )}
          <div className="flex gap-2">
            <Button
              disabled={step.plan.items.length === 0}
              onClick={() => void restore(step.plan)}
            >
              Restore {plural(step.plan.items.length, "note")}
            </Button>
            <Button variant="ghost" onClick={() => setStep({ name: "idle" })}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {(step.name === "running" || step.name === "done") && (
        <div className="mt-4 flex flex-col gap-3" aria-live="polite">
          {step.name === "running" && (
            <div
              role="progressbar"
              aria-label="Restore progress"
              aria-valuemin={0}
              aria-valuemax={step.progress.total}
              aria-valuenow={step.progress.done}
              className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"
            >
              <div
                className="h-full rounded-full bg-maple-600 transition-[width]"
                style={{
                  width: `${step.progress.total ? Math.round((step.progress.done / step.progress.total) * 100) : 100}%`,
                }}
              />
            </div>
          )}
          <p className="text-sm">
            {step.name === "running"
              ? `Restoring… ${step.progress.done.toLocaleString()} of ${step.progress.total.toLocaleString()}`
              : `Restored ${plural(step.progress.imported, "note")} and ${plural(step.progress.files, "file")}.` +
                (step.progress.labels > 0
                  ? ` Added ${plural(step.progress.labels, "label")}.`
                  : "") +
                (step.progress.skipped > 0
                  ? ` ${plural(step.progress.skipped, "note was", "notes were")} already here.`
                  : "")}
          </p>
          {step.name === "done" && step.progress.stopped && (
            <p
              role="alert"
              className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
            >
              Stopped before the last {plural(step.progress.total - step.progress.done, "note")}. {step.progress.stopped}{" "}
              Then restore the same file again: notes already restored are skipped.
            </p>
          )}
          {step.progress.failed.length > 0 && (
            <ProblemList
              title={
                step.name === "done"
                  ? "Not everything could be restored:"
                  : "Problems so far:"
              }
              items={step.progress.failed.map(
                (f) => `${f.source}: ${f.reason}`,
              )}
            />
          )}
        </div>
      )}
    </section>
  );
}

function ProblemList({ title, items }: { title: string; items: string[] }) {
  return (
    <div
      role="alert"
      className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
    >
      <p>{title}</p>
      <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5">
        {items.slice(0, 50).map((item, i) => (
          <li key={i} className="break-words">
            {item}
          </li>
        ))}
        {items.length > 50 && <li>…and {items.length - 50} more.</li>}
      </ul>
    </div>
  );
}
