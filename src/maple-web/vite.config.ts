import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the SPA runs on Vite's dev server and proxies API calls to the ASP.NET Core server
// (http profile in src/MapleNotes.Server/Properties/launchSettings.json). In production the built files
// are copied into the server's wwwroot, so the browser talks to a single origin.
const apiTarget = process.env.MAPLE_API_URL ?? "http://localhost:5051";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: false },
      "/healthz": { target: apiTarget, changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
