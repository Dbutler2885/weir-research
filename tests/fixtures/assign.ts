import { Coordinator } from "../../server/coordinator.mjs";

// Researchers start only on a coordinator's assignments: this stands in for the
// coordinator, assigning every queued batch to the given agent.
export function assignQueued(store: any, pool: any, engine: "claude" | "codex", brief = "Fixture brief: investigate the fictional record.") {
  let coordinator = pool.coordinator;
  if (!coordinator) {
    coordinator = new Coordinator(store);
    coordinator.attach("Test coordinator", "coordinator-session-for-fixture-01");
    pool.coordinator = coordinator;
  }
  const session = coordinator.session.secret;
  for (const i of store.state.investigations.filter((i: any) => i.status === "queued" && !coordinator.assignment(i.id)))
    coordinator.command({ action: "assign", session, investigationId: i.id, engine, brief });
  pool.pump();
  return coordinator;
}
