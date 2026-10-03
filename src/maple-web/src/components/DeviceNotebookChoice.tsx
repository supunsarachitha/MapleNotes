import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { HardDrive } from "lucide-react";
import { useState, type FormEvent } from "react";
import { createNotebook, isInstalledApp, openNotebook, useNotebookOnDevice } from "../lib/deviceNotebook";
import { DEFAULT_PREFERENCES } from "../lib/preferences";
import { queryKeys } from "../lib/queries";
import { navigate } from "../lib/router";
import { Button, ErrorMessage, TextField } from "./ui";

/** Shows the notebook instead of the server: everything cached before goes, and the status is read again. */
function useShowNotebook() {
  const client = useQueryClient();
  return async () => {
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
    navigate("/", { replace: true });
    await client.invalidateQueries({ queryKey: queryKeys.status });
  };
}

function CreateNotebookDialog({ open, onOpenChange, appName }: { open: boolean; onOpenChange: (open: boolean) => void; appName: string }) {
  const show = useShowNotebook();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createNotebook({ displayName: name, appName, preferences: DEFAULT_PREFERENCES });
      await show();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The notebook could not be created.");
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 text-left shadow-xl dark:bg-stone-900">
          <Dialog.Title className="text-lg font-semibold">Keep notes on this device</Dialog.Title>
          <Dialog.Description asChild>
            <div className="mt-2 flex flex-col gap-2 text-sm text-stone-600 dark:text-stone-300">
              <p>
                Your notes are kept in a database in this app, on this device only, and it works without a connection
                or a server. There is no account and no password.
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Nothing is synced or backed up. Export your notes from Settings now and then.</li>
                <li>Uninstalling the app or clearing its data deletes them.</li>
                <li>Files and photos cannot be attached.</li>
              </ul>
            </div>
          </Dialog.Description>
          <form onSubmit={(event) => void create(event)} className="mt-4 flex flex-col gap-4">
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <TextField
              label="Name (optional)"
              value={name}
              maxLength={64}
              placeholder="My notebook"
              onChange={(event) => setName(event.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="ghost">Cancel</Button>
              </Dialog.Close>
              <Button type="submit" busy={busy}>
                Create notebook
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The sign-in page's way to a notebook kept on this device (lib/deviceNotebook.ts): open the one this device has, or,
 * where administrators allow it and the app runs installed, create one. A notebook already on the device always opens,
 * whatever the setting says now, since its notes exist nowhere else.
 */
export function DeviceNotebookChoice({ allowed, appName }: { allowed: boolean; appName: string }) {
  const notebook = useNotebookOnDevice();
  const show = useShowNotebook();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (notebook.isPending) return null;

  if (notebook.data) {
    const open = async () => {
      try {
        await openNotebook(appName);
        await show();
      } catch {
        setError("The notebook could not be opened.");
      }
    };
    return (
      <div className="flex flex-col items-center gap-2">
        <p>
          This device has a notebook, <strong className="font-medium text-stone-800 dark:text-stone-100">{notebook.data.displayName}</strong>.
        </p>
        <Button variant="secondary" onClick={() => void open()}>
          <HardDrive className="size-4" aria-hidden="true" /> Open the notebook on this device
        </Button>
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </div>
    );
  }

  if (!allowed) return null;
  if (!isInstalledApp()) {
    return <p>Install {appName} as an app to keep notes on this device without an account.</p>;
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <p>Or use {appName} without an account.</p>
      <Button variant="secondary" onClick={() => setCreating(true)}>
        <HardDrive className="size-4" aria-hidden="true" /> Keep notes on this device
      </Button>
      <CreateNotebookDialog open={creating} onOpenChange={setCreating} appName={appName} />
    </div>
  );
}
