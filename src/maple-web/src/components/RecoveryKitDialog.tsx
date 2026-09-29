import * as Dialog from "@radix-ui/react-dialog";
import { RecoveryKit } from "./RecoveryKit";

/**
 * Shows a new recovery key in a dialog that cannot be dismissed until the user confirms they saved it: closing it by
 * accident would lose the key.
 */
export function RecoveryKitDialog({
  recoveryKey,
  username,
  onDone,
}: {
  recoveryKey: string | null;
  username: string;
  onDone: () => void;
}) {
  return (
    <Dialog.Root open={recoveryKey !== null}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-stone-900"
        >
          <Dialog.Title className="mb-3 text-lg font-semibold">Save your recovery key</Dialog.Title>
          <Dialog.Description className="sr-only">Your new recovery key, shown only once.</Dialog.Description>
          {recoveryKey && <RecoveryKit recoveryKey={recoveryKey} username={username} confirmLabel="Done" onConfirmed={onDone} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
