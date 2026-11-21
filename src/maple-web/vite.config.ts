import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// In development the SPA runs on Vite's dev server and proxies API calls to the ASP.NET Core server
// (http profile in src/MapleNotes.Server/Properties/launchSettings.json). In production the built files
// are copied into the server's wwwroot, so the browser talks to a single origin.
const apiTarget = process.env.MAPLE_API_URL ?? "http://localhost:5051";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Lets the media service worker, served from /src/sw/ in development, control the whole app.
    headers: { "Service-Worker-Allowed": "/" },
    proxy: {
      "/api": { target: apiTarget, changeOrigin: false },
      "/healthz": { target: apiTarget, changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    // What the first screen needs is about 800 KB (255 KB gzipped): React DOM, the Markdown pipeline and the note
    // pages. The largest pages that are not the first screen (Settings, Budgets, Habits, Help; see App.tsx) and code
    // only some accounts need (the browser export with fflate, the Argon2id fallback) are loaded on demand. The
    // service worker saves every output file when it installs, so those pages open offline too.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
