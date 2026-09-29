import { Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui";

/** The text of the downloadable recovery kit. */
export function recoveryKitText(recoveryKey: string, username: string, server: string, created: Date): string {
  return [
    "Maple Notes recovery key",
    "========================",
    "",
    `Account:  @${username}`,
    `Server:   ${server}`,
    `Created:  ${created.toISOString().slice(0, 10)}`,
    "",
    "Recovery key:",
    "",
    `    ${recoveryKey}`,
    "",
    "If you forget your password, this key is the only way to set a new one without losing your notes:",
    'choose "Forgot your password?" on the sign-in page. Anyone who has this key and knows your username',
    "can do the same, so keep it private: in a password manager, or printed and put away. It stops working",
    "once used, or when you create a new one in Settings.",
    "",
  ].join("\n");
}

/**
 * Shows a new recovery key once, with ways to keep it, and asks the user to confirm they did before continuing.
 */
export function RecoveryKit({
  recoveryKey,
  username,
  confirmLabel,
  onConfirmed,
}: {
  recoveryKey: string;
  username: string;
  confirmLabel: string;
  onConfirmed: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
    } catch {
      // Clipboard access denied: the key is still shown and selectable.
    }
  }

  function download() {
    const text = recoveryKitText(recoveryKey, username, window.location.origin, new Date());
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `maple-notes-recovery-key-${username}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-stone-600 dark:text-stone-300">
        This key is the only way to reset your password without losing your notes. It is shown only now: keep it
        somewhere safe and separate from this device, such as a password manager or a printout.
      </p>
      <output
        aria-label="Recovery key"
        className="block select-all break-words rounded-xl border border-stone-200 bg-stone-50 p-4 text-center font-mono text-base leading-relaxed tracking-wide dark:border-stone-700 dark:bg-stone-950"
      >
        {recoveryKey}
      </output>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void copy()}>
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button variant="secondary" onClick={download}>
          <Download className="size-4" aria-hidden="true" />
          Download
        </Button>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-maple-600"
        />
        I have saved my recovery key somewhere safe.
      </label>
      <Button disabled={!saved} onClick={onConfirmed} className="self-end">
        {confirmLabel}
      </Button>
    </div>
  );
}
