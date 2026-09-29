import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { NoteList } from "../components/NoteList";
import { TodoCard } from "../components/TodoCard";
import { useToast } from "../components/Toaster";
import { Button, EmptyState } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { usePreferences } from "../lib/preferences";
import { useInvalidateNotes } from "../lib/queries";
import { Link } from "../lib/router";
import { serializeTodo } from "../lib/todo";

/** Shown instead of a tab whose feature is turned off; its notes are kept. */
export function FeatureOff({ title, children }: { title: string; children: string }) {
  return (
    <EmptyState title={title}>
      {children}{" "}
      <Link href="/settings" className="font-medium text-maple-700 underline dark:text-maple-400">
        Turn it on in Settings.
      </Link>
    </EmptyState>
  );
}

function NewList({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const invalidate = useInvalidateNotes();
  const toast = useToast();

  async function create(event: FormEvent) {
    event.preventDefault();
    const title = name.trim();
    if (!title || saving) return;
    setSaving(true);
    try {
      const note = await api.createNote(serializeTodo({ title, items: [] }), [], { kind: "Todo" });
      setName("");
      await invalidate();
      onCreated(note.id);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not create the list.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void create(event)} className="flex gap-2">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="New list, e.g. Groceries"
        aria-label="New list name"
        maxLength={300}
        className="h-11 min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-3 text-base outline-none focus:border-maple-500 dark:border-stone-700 dark:bg-stone-900"
      />
      <Button type="submit" busy={saving} disabled={!name.trim()} className="h-11">
        <Plus className="size-4" aria-hidden="true" /> Create list
      </Button>
    </form>
  );
}

/** The Todo tab: the user's todo lists, pinned ones first. */
export function TodoPage() {
  const { todoLists } = usePreferences();
  const [created, setCreated] = useState<string | null>(null);

  if (!todoLists) {
    return (
      <>
        <h1 className="mb-4 text-xl font-semibold">Todo</h1>
        <FeatureOff title="Todo lists are turned off">Your lists are kept and come back when you turn them on again.</FeatureOff>
      </>
    );
  }

  const card = (note: Parameters<typeof TodoCard>[0]["note"]) => <TodoCard note={note} autoFocus={note.id === created} />;
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Todo</h1>
      <NewList onCreated={setCreated} />
      <div className="mt-6 flex flex-col gap-6">
        <NoteList
          state="pinned"
          kinds={["Todo"]}
          renderNote={card}
          showEndMarker={false}
          header={<h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Pinned</h2>}
        />
        <NoteList
          state="feed"
          kinds={["Todo"]}
          renderNote={card}
          empty={<EmptyState title="No lists yet">Create one above, then add items and tick them off as you go.</EmptyState>}
        />
      </div>
    </>
  );
}
