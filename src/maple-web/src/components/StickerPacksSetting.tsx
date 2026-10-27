import { useRef, useState } from "react";
import {
  StickerPackError,
  addStickerPack,
  removeStickerPack,
  stickerCount,
  useStickerPacks,
  useStickerSrc,
  type StickerPack,
} from "../lib/stickers";
import { ConfirmDialog } from "./ConfirmDialog";
import { useToast } from "./Toaster";
import { Button } from "./ui";

function Cover({ pack }: { pack: StickerPack }) {
  const src = useStickerSrc(pack.stickers[0]);
  return src ? <img src={src} alt="" className="size-10 shrink-0 object-contain" /> : <span className="size-10 shrink-0" />;
}

const details = (pack: StickerPack) =>
  [stickerCount(pack.stickers.length), pack.author ? `by ${pack.author}` : null, pack.licence].filter(Boolean).join(" · ");

/**
 * The sticker packs in this browser, under the Stickers switch (as in Falcon Notes). A pack is added from a ZIP file
 * chosen in the file picker, since the app never downloads one; a pack with the same ID replaces the one it updates.
 * Removing a pack leaves the stickers already on notes, which are the notes' own files.
 */
export function StickerPacksSetting() {
  const packs = useStickerPacks();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<StickerPack | null>(null);
  const [busyRemoving, setBusyRemoving] = useState(false);

  async function add(files: File[]) {
    setAdding(true);
    try {
      for (const file of files) {
        try {
          const { pack, replaced } = await addStickerPack(file, file.name);
          toast.info(`${replaced ? "Updated" : "Added"} “${pack.name}”: ${stickerCount(pack.stickers.length)}.`);
        } catch (error) {
          toast.error(`${file.name}: ${error instanceof StickerPackError ? error.message : "Could not add this sticker pack."}`);
        }
      }
    } finally {
      setAdding(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusyRemoving(true);
    try {
      await removeStickerPack(removing.id);
      toast.info(`Removed “${removing.name}”.`);
    } catch {
      toast.error("Could not remove this sticker pack.");
    } finally {
      setBusyRemoving(false);
      setRemoving(null);
    }
  }

  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Sticker packs</p>
          <p className="text-sm text-stone-600 dark:text-stone-300">
            A sticker pack is a ZIP file of pictures. Download one in your browser, or make your own, then add it here.
          </p>
        </div>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          multiple
          className="hidden"
          data-testid="sticker-pack-input"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length > 0) void add(files);
          }}
        />
        <Button variant="secondary" busy={adding} className="shrink-0" onClick={() => input.current?.click()}>
          Add pack…
        </Button>
      </div>

      {packs && packs.length > 0 ? (
        <ul
          className="mt-3 divide-y divide-stone-100 rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800"
          aria-label="Sticker packs"
        >
          {packs.map((pack) => (
            <li key={pack.id} className="flex items-center gap-3 px-3 py-2">
              <Cover pack={pack} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{pack.name}</p>
                <p className="truncate text-xs text-stone-500 dark:text-stone-400">{details(pack)}</p>
              </div>
              <button
                type="button"
                onClick={() => setRemoving(pack)}
                aria-label={`Remove ${pack.name}`}
                className="shrink-0 text-sm font-medium text-red-700 underline-offset-2 hover:underline dark:text-red-400"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        packs && <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">No sticker packs yet.</p>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove “${removing?.name ?? ""}”?`}
        description="Its stickers leave the sticker picker. Stickers already on your notes stay where they are."
        confirmLabel="Remove"
        busy={busyRemoving}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
