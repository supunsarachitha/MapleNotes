import { useState } from "react";
import { Link } from "../lib/router";
import { useStickerPacks, useStickerSrc, type Sticker } from "../lib/stickers";
import { cn } from "./ui";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maple-500";

function StickerButton({ sticker, onChoose }: { sticker: Sticker; onChoose: (sticker: Sticker) => void }) {
  const src = useStickerSrc(sticker);
  return (
    <button
      type="button"
      aria-label={`Add sticker: ${sticker.name}`}
      title={sticker.name}
      onClick={() => onChoose(sticker)}
      className={cn("flex aspect-square w-full items-center justify-center rounded-xl p-1 transition-colors hover:bg-stone-100 dark:hover:bg-stone-800", focusRing)}
    >
      {src && <img src={src} alt="" decoding="async" className="size-full object-contain" />}
    </button>
  );
}

/**
 * The stickers of the packs in this browser, to put on the note being written. A pill for each pack when there are
 * several; each sticker chosen is added at once, and the picker stays open so several can be. With no pack yet, it
 * says where to add one.
 */
export function StickerPicker({ id, onChoose }: { id: string; onChoose: (sticker: Sticker) => void }) {
  const packs = useStickerPacks();
  const [shownId, setShownId] = useState<string>();
  const shown = packs?.find((pack) => pack.id === shownId) ?? packs?.[0];

  return (
    <div id={id} role="group" aria-label="Stickers" className="mt-2 border-t border-stone-100 pt-2 dark:border-stone-800">
      {packs === null ? (
        <p className="px-1 py-2 text-sm text-stone-500 dark:text-stone-400">Loading…</p>
      ) : !shown ? (
        <p className="px-1 py-2 text-sm text-stone-600 dark:text-stone-300">
          No sticker packs yet. Add one in{" "}
          <Link href="/settings/features" className="font-medium text-maple-700 underline-offset-2 hover:underline dark:text-maple-400">
            Settings → Features
          </Link>
          .
        </p>
      ) : (
        <>
          {packs.length > 1 && (
            <div className="mb-2 flex gap-1 overflow-x-auto pb-1" aria-label="Sticker packs">
              {packs.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  aria-pressed={pack === shown}
                  onClick={() => setShownId(pack.id)}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1 text-sm font-medium transition-colors",
                    pack === shown
                      ? "bg-maple-100 text-maple-800 dark:bg-maple-600/20 dark:text-maple-300"
                      : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800",
                    focusRing,
                  )}
                >
                  {pack.name}
                </button>
              ))}
            </div>
          )}
          <ul className="grid max-h-64 grid-cols-4 gap-1 overflow-y-auto sm:grid-cols-6" aria-label={shown.name}>
            {shown.stickers.map((sticker) => (
              <li key={sticker.file}>
                <StickerButton sticker={sticker} onChoose={onChoose} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
