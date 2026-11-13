// Writes dist/build-manifest.json: the SHA-256 hash of every file the build produced, under the path the server
// serves it at. The same file is served by every instance (/build-manifest.json), attached to each GitHub release and
// signed there by CI, so anyone can check that an instance delivers the genuine app (scripts/verify-instance.py) and
// the app can compare what it loaded (Settings → About). The output is sorted and carries no dates, so a given commit
// always yields the same manifest.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const dist = process.argv[2] ?? "dist";
const name = "build-manifest.json";
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const paths = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else paths.push(`/${relative(dist, path).split(sep).join("/")}`);
  }
};
walk(dist);

const files = {};
for (const path of paths.filter((p) => p !== `/${name}`).sort()) {
  files[path] = createHash("sha256").update(readFileSync(join(dist, path.slice(1)))).digest("hex");
}

const manifest = { app: "maple-notes", version, algorithm: "sha256", files };
writeFileSync(join(dist, name), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${name}: ${Object.keys(files).length} files, version ${version}`);
