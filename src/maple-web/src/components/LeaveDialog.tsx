import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { usePendingLeave } from "../lib/router";
import { Button } from "./ui";

/** Asks what to do with unsaved text when the user leaves the page (see useLeaveGuard in lib/router.tsx). */
export function LeaveDialog() {
  const leave = usePendingLeave();
  const [saving, setSaving] = useState(false);
  return (
    <Dialog.Root open={leave.waiting} onOpenChange={(open) => !open && leave.stay()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl dark:bg-stone-900">
          <Dialog.Title className="text-lg font-semibold">Save your note?</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-stone-600 dark:text-stone-300">
            You have text that is not saved yet. Save it before you leave, or discard it.
          </Dialog.Description>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost">Keep editing</Button>
            </Dialog.Close>
            <Button variant="secondary" disabled={saving} onClick={leave.discard}>
              Discard
            </Button>
            <Button
              busy={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await leave.save();
                } finally {
                  setSaving(false);
                }
              }}
            >
              Save
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
