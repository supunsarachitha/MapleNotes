// Maple Notes derives and uses keys with the browser's Web Crypto API, which browsers only provide on secure pages:
// HTTPS, or http://localhost. Opened over plain HTTP at another address, the app cannot sign anyone in.

/** Whether this page can use Web Crypto (HTTPS or localhost). */
export function hasWebCrypto(): boolean {
  const secure = typeof window === "undefined" || window.isSecureContext !== false; // workers and tests have no window
  return secure && typeof globalThis.crypto?.subtle === "object";
}
