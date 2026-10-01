import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { useRef, useState, type PointerEvent } from "react";
import { MENU_INFO, menuOrder, moveItem, saveMenuOrder, type MenuItemId } from "../lib/menu";
import { usePreferences } from "../lib/preferences";
import { useSavePreferences } from "./PreferenceSections";
import { Button, IconButton, cn } from "./ui";

/**
 * The side menu's items in their order, to rearrange: drag one by its handle (mouse, pen or finger), or move it with
 * its arrow buttons, which keyboards and screen readers use. Each change is saved for the account at once. Items whose
 * feature is off stay in the list, marked, so they keep their place for when it is turned on.
 */
export function MenuOrderEditor() {
  const preferences = usePreferences();
  const save = useSavePreferences();
  const saved = menuOrder(preferences.menuOrder);
  // While dragging, the order as it is on screen; saved when the item is let go.
  const [draft, setDraft] = useState<MenuItemId[] | null>(null);
  const [held, setHeld] = useState<MenuItemId | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const rows = useRef(new Map<MenuItemId, HTMLLIElement>());
  const order = draft ?? saved;

  function commit(next: MenuItemId[], moved: MenuItemId) {
    if (next.join(",") === saved.join(",")) return;
    save({ menuOrder: saveMenuOrder(next) });
    setAnnouncement(`${MENU_INFO[moved].label} moved to position ${next.indexOf(moved) + 1} of ${next.length}.`);
  }

  function step(id: MenuItemId, by: number) {
    const from = order.indexOf(id);
    commit(moveItem(order, from, from + by), id);
  }

  function startDrag(event: PointerEvent<HTMLElement>, id: MenuItemId) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setHeld(id);
    setDraft(saved);
  }

  function drag(event: PointerEvent<HTMLElement>) {
    const id = held;
    if (!id || !draft) return;
    const from = draft.indexOf(id);
    for (const [other, row] of rows.current) {
      if (other === id) continue;
      const box = row.getBoundingClientRect();
      if (event.clientY < box.top || event.clientY > box.bottom) continue;
      // Past the middle of the row in the direction of travel: the rows swap, without flickering back and forth.
      const to = draft.indexOf(other);
      const middle = box.top + box.height / 2;
      if ((to > from && event.clientY > middle) || (to < from && event.clientY < middle)) setDraft(moveItem(draft, from, to));
      break;
    }
  }

  function endDrag() {
    if (held && draft) commit(draft, held);
    setHeld(null);
    setDraft(null);
  }

  return (
    <div>
      <ol aria-label="Menu items in order" className="divide-y divide-stone-100 rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
        {order.map((id, index) => {
          const { label, icon: Icon, shown, feature } = MENU_INFO[id];
          const off = !shown(preferences);
          return (
            <li
              key={id}
              ref={(row) => {
                if (row) rows.current.set(id, row);
                else rows.current.delete(id);
              }}
              className={cn(
                "flex min-h-12 items-center gap-2 bg-white px-2 first:rounded-t-xl last:rounded-b-xl dark:bg-stone-900",
                held === id && "relative z-10 shadow-lg ring-2 ring-maple-500",
              )}
            >
              <span
                aria-hidden="true"
                title="Drag to move"
                onPointerDown={(event) => startDrag(event, id)}
                onPointerMove={drag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 active:cursor-grabbing dark:hover:bg-stone-800"
              >
                <GripVertical className="size-5" />
              </span>
              <Icon className={cn("size-5 shrink-0", off ? "text-stone-400" : "text-stone-600 dark:text-stone-300")} aria-hidden="true" />
              <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", off && "text-stone-500 dark:text-stone-400")}>
                {label}
                {off && <span className="ml-2 text-xs font-normal">Hidden: {feature} is off</span>}
              </span>
              <IconButton label={`Move ${label} up`} className="size-9" disabled={index === 0} onClick={() => step(id, -1)}>
                <ArrowUp className="size-4" />
              </IconButton>
              <IconButton label={`Move ${label} down`} className="size-9" disabled={index === order.length - 1} onClick={() => step(id, 1)}>
                <ArrowDown className="size-4" />
              </IconButton>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {preferences.menuOrder !== "" && (
          <Button variant="secondary" className="h-9" onClick={() => save({ menuOrder: "" })}>
            Back to the usual order
          </Button>
        )}
        <span className="text-sm text-stone-600 dark:text-stone-300">Drag an item by its handle, or use its arrows.</span>
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
