import { CalendarClock, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { BottomBar } from "../components/BottomBar";
import { Advice, BudgetChart, ForecastSummary, ProjectHeader } from "../components/BudgetOverview";
import { CostPanel, CostSheets, CostTabs, type OpenSheet, type Tab } from "../components/BudgetCosts";
import { AllowanceSheet, percentLabel, useBudgetCurrency, useMoney } from "../components/BudgetParts";
import { ForecastEffect } from "../components/BudgetSheets";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ImageViewer } from "../components/ImageViewer";
import { useRemoveNote } from "../components/NoteRemoval";
import { useToast } from "../components/Toaster";
import { Button, EmptyState } from "../components/ui";
import { api, uploadAttachment, ApiError } from "../lib/api";
import { forecast, isFinished, parseBudget, progressOf, removeCost, serializeBudget, towardsOf, type Budget, type BudgetLine } from "../lib/budgets";
import { useToday } from "../lib/daily";
import { localDateKey } from "../lib/dates";
import { useNoteEditor } from "../lib/noteEditor";
import { usePreferences } from "../lib/preferences";
import { useBudgets, usePatchNote } from "../lib/queries";
import { Link } from "../lib/router";
import { shrinkPhoto } from "../lib/shrinkPhoto";
import type { Attachment, Note } from "../lib/types";
import { saveErrorMessage } from "../lib/apiError";

const receiptsOf = (budget: Budget) => [...budget.spent, ...budget.expected].flatMap((line) => (line.receipt ? [line.receipt] : []));
const byDate = (a: { line: BudgetLine }, b: { line: BudgetLine }) => a.line.date.localeCompare(b.line.date);


function ProjectView({ note }: { note: Note }) {
  const today = localDateKey(useToday());
  const preferences = usePreferences();
  const money = useMoney();
  const currency = useBudgetCurrency();
  const toast = useToast();
  const patch = usePatchNote();
  const parse = useCallback((content: string) => parseBudget(content, { today, surprisePercent: preferences.budgetSurprisePercent }), [today, preferences.budgetSurprisePercent]);
  const [budget, commit] = useNoteEditor<Budget>(
    note,
    parse,
    serializeBudget,
    (error) => toast.error(saveErrorMessage(error, "A change to this project could not be saved. Please try again.")),
    receiptsOf,
  );
  const [tab, setTab] = useState<Tab>("expected");
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [deleting, setDeleting] = useState<{ kind: "spent" | "expected"; index: number } | null>(null);
  const [extra, setExtra] = useState<Record<string, Attachment>>({});
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const removal = useRemoveNote(note, {
    noun: "project",
    confirmTitle: "Delete this project?",
    confirmDescription: `"${budget.name}" and all its costs will be deleted permanently.`,
  });
  const f = forecast(budget, today);
  const readOnly = note.isArchived;
  const ended = isFinished(budget, today);
  const attachment = (id: string) => note.attachments.find((a) => a.id === id) ?? extra[id];

  async function upload(file: File): Promise<Attachment> {
    try {
      const ready = preferences.shrinkPhotos && file.type.startsWith("image/") ? await shrinkPhoto(file, preferences.photoSize) : file;
      const added = await uploadAttachment(ready, () => {});
      setExtra((current) => ({ ...current, [added.id]: added }));
      return added;
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "The photo could not be uploaded. Please try again.");
      throw error;
    }
  }
  const discard = (ids: string[]) => ids.forEach((id) => void api.deleteAttachment(id).catch(() => undefined));

  /** Saves a change, then deletes the photos it dropped (once the note no longer holds them). */
  function save(next: Budget, dropped: string[] = []) {
    void commit(next).then(() => discard(dropped));
  }

  const expected = budget.expected.map((line, index) => ({ line, index })).sort(byDate);
  const spentGroups = new Map<string, Array<{ line: BudgetLine; index: number }>>();
  for (const item of budget.spent.map((line, index) => ({ line, index })).sort((a, b) => b.line.date.localeCompare(a.line.date))) {
    spentGroups.set(item.line.date, [...(spentGroups.get(item.line.date) ?? []), item]);
  }
  const viewed = sheet?.type === "view" ? budget[sheet.kind][sheet.index] : undefined;
  const effectOf = (percent: number) => (
    <ForecastEffect before={f} after={forecast({ ...budget, surprisePercent: percent }, today)} money={money} />
  );

  return (
    <>
      <ProjectHeader note={note} budget={budget} readOnly={readOnly} removal={removal} patch={patch} toast={toast} setSheet={setSheet} />
      {removal.dialog}

      {readOnly && (
        <p className="mb-4 rounded-xl bg-stone-200 px-4 py-3 text-sm dark:bg-stone-800">This project is archived. Restore it from the ⋯ menu to change it.</p>
      )}

      <ForecastSummary budget={budget} forecast={f} ended={ended} readOnly={readOnly} money={money} setSheet={setSheet} />

      <div className="mt-3 flex flex-col gap-3">
        <BudgetChart budget={budget} forecast={f} today={today} money={money} />
        {f.pastDue.length > 0 && !ended && (
          <p role="status" className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <CalendarClock className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            {f.pastDue.length === 1
              ? "1 expected cost is past due. Mark it paid or move the date."
              : `${f.pastDue.length} expected costs are past due. Mark them paid or move the date.`}
          </p>
        )}
        <Advice budget={budget} forecast={f} today={today} money={money} />
      </div>

      <CostTabs tab={tab} setTab={setTab} />

      <CostPanel
        tab={tab}
        budget={budget}
        forecast={f}
        expected={expected}
        spentGroups={spentGroups}
        today={today}
        readOnly={readOnly}
        money={money}
        setSheet={setSheet}
      />

      {!readOnly && (
        <BottomBar>
          <Button variant="secondary" className="h-12 flex-1 text-base" onClick={() => setSheet({ type: "cost", mode: { kind: "expected" } })}>
            <CalendarClock className="size-5" aria-hidden="true" /> Expect
          </Button>
          <Button className="h-12 flex-1 text-base" onClick={() => setSheet({ type: "cost", mode: { kind: "spent" } })}>
            <Plus className="size-5" aria-hidden="true" /> Spent
          </Button>
        </BottomBar>
      )}

      <CostSheets
        sheet={sheet}
        setSheet={setSheet}
        budget={budget}
        viewed={viewed}
        today={today}
        money={money}
        currency={currency}
        readOnly={readOnly}
        toast={toast}
        save={save}
        upload={upload}
        discard={discard}
        attachment={attachment}
        setDeleting={setDeleting}
        setViewing={setViewing}
      />
      <AllowanceSheet
        open={sheet?.type === "allowance"}
        onOpenChange={(open) => setSheet(open ? { type: "allowance" } : null)}
        value={budget.surprisePercent}
        description={
          <>
            A percentage of what's still expected in <span className="font-semibold">{budget.name}</span>, added to the forecast. Real costs usually come in higher
            than quotes. Renovations often run 10–20% over.
          </>
        }
        effect={effectOf}
        onSave={(percent) => {
          save({ ...budget, surprisePercent: percent });
          setSheet(null);
          toast.info(percent ? `Allowance for surprises: ${percentLabel(percent)}` : "Allowance for surprises turned off");
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this cost?"
        description={(() => {
          const line = deleting ? budget[deleting.kind][deleting.index] : undefined;
          if (!deleting || !line) return "";
          const payments = deleting.kind === "expected" ? progressOf(budget, line).payments.length : 0;
          const towards = deleting.kind === "spent" ? towardsOf(budget, line) : undefined;
          return [
            `"${line.title}" (${money(line.amount)})${line.receipt ? " and its photo" : ""} will be deleted.`,
            payments === 1 ? "The payment made towards it stays as spent." : payments > 1 ? `The ${payments} payments made towards it stay as spent.` : "",
            towards ? `Its amount goes back into what's left of ${towards.title || towards.category}.` : "",
          ]
            .filter(Boolean)
            .join(" ");
        })()}
        confirmLabel="Delete"
        onConfirm={() => {
          if (!deleting) return;
          const line = budget[deleting.kind][deleting.index];
          save(removeCost(budget, deleting.kind, deleting.index), line?.receipt ? [line.receipt] : []);
          setDeleting(null);
          toast.info("Deleted");
        }}
      />
      <ImageViewer images={viewing ? [viewing] : []} index={viewing ? 0 : null} onIndexChange={() => undefined} onClose={() => setViewing(null)} />
    </>
  );
}

/** One budget project: its forecast, chart, advice and costs, with sheets to add, edit and pay them. */
export function BudgetProjectPage({ id }: { id: string }) {
  const active = useBudgets("active");
  const archived = useBudgets("archived");
  const note = active.data?.find((n) => n.id === id) ?? archived.data?.find((n) => n.id === id);
  if (note) return <ProjectView key={note.id} note={note} />;
  if (active.isPending || archived.isPending)
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading the project">
        <div className="h-48 animate-pulse rounded-2xl bg-stone-200 dark:bg-stone-800" />
        <div className="h-40 animate-pulse rounded-2xl bg-stone-200 dark:bg-stone-800" />
      </div>
    );
  return (
    <EmptyState title="This project isn't here">
      It may have been moved to the trash.{" "}
      <Link href="/budgets" className="font-medium text-maple-700 underline dark:text-maple-400">
        Back to Budgets
      </Link>
    </EmptyState>
  );
}
