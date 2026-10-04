// The human's TypeSafe key stays with the app. The human gives it as TYPESAFE_API_KEY
// in the environment of whatever starts the app; from there it is moved into a file of
// the app's own, which only the human's account can read and no agent's sandbox
// reaches, and it is taken out of the environment. A process's first environment can
// be read by other processes for as long as it runs, so the app's services are
// started without the key in theirs, and read the file instead.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NAME = "TYPESAFE_API_KEY";
// A key is one run of printable characters: anything else, such as a line break pasted
// with it, cannot be sent, and is not a key.
const wellFormed = (key) => /^[\x21-\x7e]{8,}$/.test(key);

export const keyFile = (home) => join(home, "typesafe-key");

// Moves a key in the environment into the app's file and out of the environment.
// Everything that starts one of the app's services does this first.
export function stowKey(home, env = process.env) {
  const given = (env[NAME] || "").trim();
  delete env[NAME];
  if (!wellFormed(given) || given === typesafeKey(home)) return;
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = keyFile(home);
  writeFileSync(`${file}.tmp`, given, { mode: 0o600 });
  chmodSync(`${file}.tmp`, 0o600);
  renameSync(`${file}.tmp`, file);
}

// The key the app holds, or "" when it has none.
export function typesafeKey(home) {
  try {
    const key = readFileSync(keyFile(home), "utf8").trim();
    return wellFormed(key) ? key : "";
  } catch {
    return "";
  }
}
