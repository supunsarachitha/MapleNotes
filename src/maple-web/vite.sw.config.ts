import { defineConfig } from "vite";

// Builds the media service worker (src/sw) as one classic script at the site root, /sw.js, so that it can control
// the whole app. It runs after the main build and adds to the same output folder.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: "src/sw/index.ts",
      formats: ["iife"],
      name: "mapleMediaWorker",
      fileName: () => "sw.js",
    },
  },
});
