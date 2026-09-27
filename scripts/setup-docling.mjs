// Installs Docling, the High accuracy PDF reader, into the app's tools folder.
// The app runs this when High accuracy is chosen; `npm run setup:pdf` runs it by hand.
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installDocling } from "../server/pdf/docling.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const home = resolve(process.env.RESEARCH_HOME || join(root, ".research"));
try {
  await installDocling(home, { log: (line) => console.log(line) });
} catch (error) {
  console.error(`Docling setup failed: ${error.message}`);
  process.exitCode = 1;
}
