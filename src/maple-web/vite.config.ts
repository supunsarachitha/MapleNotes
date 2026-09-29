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
    // The main bundle is ~185 KB gzipped: about a third is React DOM and about 30% the Markdown pipeline, both
    // needed to render the first note, so splitting would not make the first screen appear sooner. Code only some
    // accounts need (the browser export with fflate, the Argon2id fallback) is loaded on demand.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
