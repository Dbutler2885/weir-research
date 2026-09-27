import { expect } from "vitest";

// Waits for a condition that a running agent process will bring about. The limit is
// time, not tries, and generous: a busy machine or a CI runner starts processes slowly.
export async function until(check: () => unknown, ms = 30_000) {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await new Promise((done) => setTimeout(done, 10));
  expect(check()).toBeTruthy();
}
