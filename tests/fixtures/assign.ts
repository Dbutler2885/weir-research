import { Coordinator } from "../../server/coordinator.mjs";

// Researchers start only on a coordinator's assignments: this stands in for the
// coordinator, giving every queued batch with nothing assigned one assignment for the given agent.
export function assignQueued(store: any, pool: any, engine: "claude" | "codex", brief = "Fixture brief: investigate the fictional record.") {
  let coordinator = pool.coordinator;
  if (!coordinator) {
    coordinator = new Coordinator(store);
    coordinator.attach("Test coordinator", "coordinator-session-for-fixture-01");
    pool.coordinator = coordinator;
  }
  const session = coordinator.session.secret;
  const assigned = (i: any) => (i.assignments || []).some((a: any) => ["waiting", "running", "returned"].includes(a.status));
  for (const i of store.state.investigations.filter((i: any) => i.status === "queued" && !assigned(i)))
    coordinator.command({ action: "assign", session, investigationId: i.id, engine, title: "Fixture assignment", brief });
  pool.pump();
  return coordinator;
}

// The assignment a batch's researcher is working on, or last worked on.
export function assignmentOf(store: any, investigationId: string): any {
  return store.state.investigations.find((i: any) => i.id === investigationId).assignments.at(-1);
}
