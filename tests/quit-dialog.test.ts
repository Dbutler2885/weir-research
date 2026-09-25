import { describe, expect, it } from "vitest";
import { closedNotice, keepableWorkers, quitDialog } from "../src/ui/quit-dialog";

const state = (roles: string[]) => ({ live: roles.map((role) => ({ role, name: role, startedAt: "t" })) }) as any;

describe("quitting", () => {
  it("asks whether running workers keep running, counting only workers that can", () => {
    expect(keepableWorkers(state(["researcher", "builder", "writer", "helper"]))).toBe(3);
    document.body.innerHTML = quitDialog(state(["researcher", "builder"]));
    expect(document.querySelector("h2")!.textContent).toBe("2 workers are still working");
    expect([...document.querySelectorAll("[data-quit]")].map((b) => b.textContent)).toEqual(["Keep them running", "Stop them", "Cancel"]);
  });
  it("only confirms quitting when nothing would be kept", () => {
    document.body.innerHTML = quitDialog(state(["helper"]));
    expect(document.querySelector("h2")!.textContent).toBe("Quit the app?");
    expect([...document.querySelectorAll("[data-quit]")].map((b) => b.getAttribute("data-quit"))).toEqual(["stop", "cancel"]);
  });
  it("says what keeps running once the app has closed", () => {
    document.body.innerHTML = closedNotice(1);
    expect(document.body.textContent).toContain("One worker keeps running and is taken back when the app opens again.");
  });
});
