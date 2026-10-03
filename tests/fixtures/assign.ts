import { Coordinator } from "../../server/coordinator.mjs";

// Stands in for the coordinator: opens a batch with a goal, whose team the pool starts.
// The team has one researcher unless a size is given.
export function openTeam(
  store: any,
  pool: any,
  engine: "claude" | "codex",
  { size = 1, goal = "Fixture goal: find out about the fictional record.", title = "Fixture batch", scope }: { size?: number; goal?: string; title?: string; scope?: string[] } = {},
) {
  let coordinator = pool.coordinator;
  if (!coordinator) {
    coordinator = new Coordinator(store);
    coordinator.attach("Test coordinator", "coordinator-session-for-fixture-01");
    pool.coordinator = coordinator;
    coordinator.researchers = pool;
  }
  store.update((next: any) => (next.researchSettings = { timeLimitMinutes: null, ...(next.researchSettings || {}), researchersPerBatch: size }));
  const session = coordinator.session.secret;
  const { investigationId } = coordinator.command({ action: "open-batch", session, engine, title, goal, ...(scope ? { scope } : {}) });
  pool.pump();
  return { coordinator, session, investigationId: investigationId as string };
}

// A batch's seat, by its place in the team: the first unless another is named.
export function assignmentOf(store: any, investigationId: string, place = 0): any {
  return store.state.investigations.find((i: any) => i.id === investigationId).assignments[place];
}
