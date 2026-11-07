import { api } from "./api";
import type { PushDevice } from "./types";

// Notifications on this device: the browser's Push API subscription, registered with the server, which sends
// reminders to it (Features/Push). The service worker shows them (sw/notify.ts).

export type PushSupport =
  /** Ready to ask. */
  | "supported"
  /** iPhone or iPad Safari in a tab: push works only once the app is added to the Home Screen (iOS 16.4+). */
  | "ios-home-screen"
  /** This browser has no Push API, or the page is not on HTTPS. */
  | "unsupported";

/** Whether this browser can receive notifications, and if not, why. */
export function pushSupport(): PushSupport {
  const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  if (apple && !installed && !("PushManager" in window)) return "ios-home-screen";
  return window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
    ? "supported"
    : "unsupported";
}

/** A short name for this device, such as "Chrome on Android", from the browser's user agent. */
export function deviceName(userAgent = navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const system = /Android/.test(userAgent)
    ? "Android"
    : /iPhone/.test(userAgent)
      ? "iPhone"
      : /iPad/.test(userAgent)
        ? "iPad"
        : /Mac OS X/.test(userAgent)
          ? "Mac"
          : /Windows/.test(userAgent)
            ? "Windows"
            : /Linux/.test(userAgent)
              ? "Linux"
              : "";
  return system ? `${browser} on ${system}` : browser;
}

const base64Url = (buffer: ArrayBuffer | null) =>
  buffer ? btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") : "";

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** The service worker's registration; it rejects after a few seconds when there is none (it never became active). */
async function registration(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Notifications need the app's service worker, which is not running. Reload the page and try again.")), 5000);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** This browser's push subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "supported") return null;
  return (await registration()).pushManager.getSubscription();
}

/** The server's record of this device, matched by its endpoint. */
export function thisDevice(devices: PushDevice[] | undefined, subscription: PushSubscription | null): PushDevice | undefined {
  return subscription ? devices?.find((device) => device.endpoint === subscription.endpoint) : undefined;
}

/**
 * Turns notifications on for this device: asks the browser for permission (it must follow a tap), subscribes with the
 * server's key, and registers the subscription. Throws a message to show when permission is refused.
 */
export async function enableNotifications(): Promise<PushDevice> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this site. Allow them in the browser's site settings, then try again."
        : "Notifications were not allowed.",
    );
  }
  const { publicKey } = await api.push.key();
  const manager = (await registration()).pushManager;
  let subscription = await manager.getSubscription();
  // A subscription made with another server key (a different server at this address) cannot receive our messages.
  const key = subscription?.options.applicationServerKey;
  if (subscription && key && base64Url(key) !== publicKey) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await manager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(publicKey) });
  return api.push.subscribe({
    endpoint: subscription.endpoint,
    p256dh: base64Url(subscription.getKey("p256dh")),
    auth: base64Url(subscription.getKey("auth")),
    name: deviceName(),
  });
}

/** Turns notifications off for this device, here and on the server. */
export async function disableNotifications(device: PushDevice | undefined): Promise<void> {
  const subscription = await currentSubscription();
  if (device) await api.push.unsubscribe(device.id);
  await subscription?.unsubscribe();
}
