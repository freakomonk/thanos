// Copies the canonical model registry (bundled in the Python package) into
// this package's src/data/ so both packages ship from one source of truth.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "python", "thanos", "data", "models.json");
const destDir = join(here, "..", "src", "data");
const dest = join(destDir, "models.json");

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`Synced pricing data: ${src} -> ${dest}`);
