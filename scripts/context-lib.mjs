import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./workspace-lib.mjs";
import { snapshotView } from "./coordinator-view.mjs";
import { Coordinator } from "../server/coordinator.mjs";
import { projectSkills } from "../server/skills.mjs";
import { repairClosedBatches } from "../src/domain/conversation.ts";

// What a fresh coordinator would read for a project, in the old and new forms,
// computed from saved state without attaching or changing anything.
export function startupContexts(p) {
  const state = JSON.parse(readFileSync(join(p.directory, "workspace.json"), "utf8"));
  // The server repairs these on load; show what it would show.
  repairClosedBatches(state);
  // A stand-in store and session, so the real snapshot code runs without attaching.
  const store = { state, update: () => { throw new Error("Startup contexts are read-only."); } };
  const coordinator = new Coordinator(store, { skills: projectSkills(root) });
  coordinator.session = { name: "Review", secret: "review", seen: Date.now(), owned: Date.now() + 60_000 };
  const { context, ...full } = coordinator.snapshot("review");
  const view = { ...snapshotView(full, "<session>", "<snapshot>", -1) };
  return { state, old: JSON.stringify(view, null, 2), layered: context };
}
