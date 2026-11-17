import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton, cn } from "./ui";

/**
 * A form that slides up from the bottom of a phone's screen, within reach of the thumb, and shows as a centred dialog
 * on wider screens. The footer (the sheet's buttons) stays visible while the body scrolls, and keeps clear of the
 * phone's home indicator. Focus is trapped inside; Escape and the close button cancel.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl bg-white text-stone-900 shadow-xl outline-none",
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85dvh] sm:w-[calc(100%-2rem)] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
            "dark:bg-stone-900 dark:text-stone-100",
            className,
          )}
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-stone-300 sm:hidden dark:bg-stone-700" aria-hidden="true" />
          <div className="flex shrink-0 items-start gap-2 px-4 pb-1 pt-2 sm:pt-4">
            <Dialog.Title className="min-w-0 flex-1 break-words pt-2 text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Close" className="-mr-1 size-11">
                <X className="size-5" />
              </IconButton>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-4">{children}</div>
          {footer && (
            <div className="flex shrink-0 gap-2 border-t border-stone-200 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 dark:border-stone-800">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
