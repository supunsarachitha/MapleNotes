// Push messages from the server (Features/Push/PushService.cs): shown as notifications, and opened on a tap.

/** A message as the server sends it. */
export interface PushPayload {
  title: string;
  body: string;
  noteId?: string | null;
  tag?: string | null;
}

/** Reads a push message; anything unreadable still shows, so the browser never counts a silent push. */
export function readPayload(text: string | null | undefined): PushPayload {
  try {
    const value = JSON.parse(text ?? "") as Partial<PushPayload>;
    if (typeof value.title === "string" && typeof value.body === "string") return value as PushPayload;
  } catch {
    // fall through
  }
  return { title: "Maple Notes", body: "You have a reminder." };
}

/** The notification to show for a message. */
export function notificationFor(payload: PushPayload): { title: string; options: NotificationOptions } {
  return {
    title: payload.title,
    options: {
      body: payload.body,
      tag: payload.tag ?? undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: openUrl(payload.noteId) },
    },
  };
}

/** Where a tap leads: the Reminders page, opened at the note the reminder was for. */
export function openUrl(noteId: string | null | undefined): string {
  return noteId && /^[0-9a-f-]{36}$/i.test(noteId) ? `/reminders?note=${noteId}` : "/reminders";
}
