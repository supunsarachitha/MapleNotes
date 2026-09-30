import { useAuthStatus } from "./queries";

// The app's name and icon, which administrators can change (Settings → Administration). They come with the sign-in
// status, so the sign-in page shows them too.

/** The app's name when administrators have not chosen another. */
export const DEFAULT_APP_NAME = "Maple Notes";

export interface Branding {
  appName: string;
  /** The custom icon, or null for the maple leaf. */
  iconUrl: string | null;
}

/** The app's name and icon; the defaults until the server has answered. */
export function useBranding(): Branding {
  const branding = useAuthStatus().data?.branding;
  return { appName: branding?.appName ?? DEFAULT_APP_NAME, iconUrl: branding?.iconUrl ?? null };
}

/** Shows the app's name in the browser tab, and its icon as the tab's icon. */
export function applyBranding({ appName, iconUrl }: Branding): void {
  document.title = appName;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  link.href = iconUrl ?? "/favicon.svg";
  if (iconUrl) link.removeAttribute("type");
  else link.type = "image/svg+xml";
}
