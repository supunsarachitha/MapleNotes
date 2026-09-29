import { Download } from "lucide-react";
import { useId, useState } from "react";
import { Button, Card, ErrorMessage, cn } from "./ui";

export type ExportFormat = "md" | "txt" | "json";
export type ExportLayout = "flat" | "year" | "month" | "day";

export interface ExportOptions {
  format: ExportFormat;
  layout: ExportLayout;
  includeArchived: boolean;
  includeAttachments: boolean;
  from?: string;
  to?: string;
  timeZone: string;
}

/** Builds the download URL for the export endpoint (a plain GET, so the browser saves the stream directly). */
export function buildExportUrl(options: ExportOptions): string {
  const params = new URLSearchParams({
    format: options.format,
    layout: options.layout,
    includeArchived: String(options.includeArchived),
    includeAttachments: String(options.includeAttachments),
    timeZone: options.timeZone,
  });
  if (options.from) params.set("from", options.from);
  if (options.to) params.set("to", options.to);
  return `/api/v1/export?${params.toString()}`;
}

const formats: Array<{ value: ExportFormat; label: string; hint: string }> = [
  { value: "md", label: "Markdown", hint: ".md with front matter" },
  { value: "txt", label: "Plain text", hint: ".txt" },
  { value: "json", label: "JSON", hint: ".json, one per note" },
];

const layouts: Array<{ value: ExportLayout; label: string; example: string }> = [
  { value: "month", label: "By month", example: "2026-09/2026-09-28_1430_title.md" },
  { value: "year", label: "By year", example: "2026/2026-09-28_1430_title.md" },
  { value: "day", label: "By day", example: "2026-09-28/2026-09-28_1430_title.md" },
  { value: "flat", label: "All in one folder", example: "2026-09-28_1430_title.md" },
];

/** Download all notes (decrypted) as a ZIP archive in the chosen format and folder layout. */
export function ExportSection({ onDownload }: { onDownload?: (url: string) => void }) {
  const id = useId();
  const [options, setOptions] = useState<ExportOptions>({
    format: "md",
    layout: "month",
    includeArchived: false,
    includeAttachments: true,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  });
  const [error, setError] = useState<string | null>(null);

  function update(changes: Partial<ExportOptions>) {
    setOptions((current) => ({ ...current, ...changes }));
    setError(null);
  }

  function download() {
    if (options.from && options.to && options.from > options.to) {
      setError("The start date must not be after the end date.");
      return;
    }
    const url = buildExportUrl(options);
    if (onDownload) {
      onDownload(url);
      return;
    }
    const link = document.createElement("a");
    link.href = url;
    link.download = "";
    document.body.append(link);
    link.click();
    link.remove();
  }

  const example = layouts.find((l) => l.value === options.layout)!.example.replace(/\.md$/, `.${options.format}`);

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">Export</h2>
      <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
        Download your notes as a ZIP archive, decrypted, with attachments in an <code>attachments</code> folder linked
        from each note.
      </p>

      <div className="mt-4 flex flex-col gap-5">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Format</legend>
          <div className="grid grid-cols-3 gap-2">
            {formats.map((format) => (
              <label
                key={format.value}
                className={cn(
                  "flex cursor-pointer flex-col rounded-xl border px-3 py-2 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-maple-500",
                  options.format === format.value
                    ? "border-maple-600 bg-maple-50 dark:bg-maple-600/15"
                    : "border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800",
                )}
              >
                <input
                  type="radio"
                  name={`${id}-format`}
                  value={format.value}
                  checked={options.format === format.value}
                  onChange={() => update({ format: format.value })}
                  className="sr-only"
                />
                <span className="font-medium">{format.label}</span>
                <span className="text-xs text-stone-500 dark:text-stone-400">{format.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor={`${id}-layout`} className="mb-2 block text-sm font-medium">
            Folders
          </label>
          <select
            id={`${id}-layout`}
            value={options.layout}
            onChange={(event) => update({ layout: event.target.value as ExportLayout })}
            className="h-11 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950"
          >
            {layouts.map((layout) => (
              <option key={layout.value} value={layout.value}>
                {layout.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 font-mono text-xs text-stone-500 dark:text-stone-400">{example}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${id}-from`} className="mb-2 block text-sm font-medium">
              From (optional)
            </label>
            <input
              id={`${id}-from`}
              type="date"
              value={options.from ?? ""}
              onChange={(event) => update({ from: event.target.value || undefined })}
              className="h-11 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950"
            />
          </div>
          <div>
            <label htmlFor={`${id}-to`} className="mb-2 block text-sm font-medium">
              To (optional)
            </label>
            <input
              id={`${id}-to`}
              type="date"
              value={options.to ?? ""}
              onChange={(event) => update({ to: event.target.value || undefined })}
              className="h-11 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm dark:border-stone-700 dark:bg-stone-950"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={options.includeAttachments}
              onChange={(event) => update({ includeAttachments: event.target.checked })}
              className="size-4 accent-maple-600"
            />
            Include attachments
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={options.includeArchived}
              onChange={(event) => update({ includeArchived: event.target.checked })}
              className="size-4 accent-maple-600"
            />
            Include archived notes
          </label>
        </div>

        {error && <ErrorMessage>{error}</ErrorMessage>}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={download}>
            <Download className="size-4" aria-hidden="true" />
            Download ZIP
          </Button>
          <span className="text-xs text-stone-500 dark:text-stone-400">Dates use your time zone ({options.timeZone}).</span>
        </div>
      </div>
    </Card>
  );
}
