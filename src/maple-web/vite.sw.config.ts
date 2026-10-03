import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { defineConfig } from "vite";

// Builds the service worker (src/sw) as one classic script at the site root, /sw.js, so that it can control the whole
// app. It runs after the main build and adds to the same output folder.

/**
 * The files the main build wrote, which the worker saves for offline use, plus the web app manifest the server builds.
 * Their names carry content hashes, so the list, and with it the worker, changes with every release that changes them:
 * that is how browsers find a new version.
 */
function shellFiles(): string[] {
  const dist = "dist";
  if (!existsSync(dist)) return [];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) walk(path);
      } else {
        files.push(`/${relative(dist, path).split(sep).join("/")}`);
      }
    }
  };
  walk(dist);
  return [...files.filter((file) => file !== "/index.html" && file !== "/sw.js"), "/manifest.webmanifest"].sort();
}

const files = shellFiles();
const version = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 16);

export default defineConfig({
  publicDir: false,
  define: { __MAPLE_SHELL__: JSON.stringify({ version, files }) },
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
