// Local integration test: launches workspace services and CLI commands, never a model provider.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const directory = mkdtempSync(join(tmpdir(), "weir-coordinator-e2e-"));
// The test drives the coordinator API itself, so the app starts no coordinator agent.
// Researchers are a stand-in Claude CLI that saves a checkpoint on its first turn and
// ends every turn by saying it has finished.
const steps = join(directory, "researcher-steps.json");
const done = { say: "Nothing is left to pursue.\n\nRESEARCH DONE" };
writeFileSync(
  steps,
  JSON.stringify({
    "post what you mean to try first": [
      {
        tool: "Write",
        input: { file_path: "checkpoint.json" },
        writes: { "checkpoint.json": JSON.stringify({ summary: "Local checkpoint", findings: "Inspected the existing record only.", nextSteps: "Nothing further." }) },
      },
      done,
    ],
    default: [done],
  }),
);
const env = {
  ...process.env,
  RESEARCH_HOME: directory,
  RESEARCH_COORDINATOR_AGENT: "0",
  RESEARCH_AGENT_CLAUDE: resolve("tests/fixtures/fake-claude.mjs"),
  FAKE_CLAUDE_STEPS: steps,
};
const run = async (script, args = []) => {
  const { stdout } = await exec(
    process.execPath,
    [resolve(`scripts/${script}.mjs`), ...args],
    { env, maxBuffer: 5_000_000 },
  );
  return JSON.parse(stdout);
};
let sessionFile;
const command = async (data) => {
  const path = join(directory, "command.json");
  writeFileSync(path, JSON.stringify(data));
  return run("coordinator", ["command", path, "--session", sessionFile]);
};
let url;
const state = async () => (await fetch(`${url}/api/state`)).json();
const waitForExit = async (pid) => {
  for (let n = 0; n < 100; n++) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Test service did not stop.");
};
try {
  const listed = await run("workspace", ["projects"]);
  assert.equal(listed.length, 0);
  await run("workspace", [
    "create",
    "fixture",
    resolve("tests/fixtures/workshop.json"),
    "Fictional workshop fixture",
  ]);
  const opened = await run("workspace", ["open", "fixture", "--no-browser"]);
  url = opened.url;
  assert.equal(
    (await run("workspace", ["open", "fixture", "--no-browser"])).url,
    url,
  );
  const attached = await run("coordinator", [
    "attach",
    "Local integration coordinator",
    "--project",
    "fixture",
  ]);
  sessionFile = attached.sessionFile;
  assert.equal(attached.project.title, "Fictional workshop fixture");
  assert.equal(attached.project.counts.nodes, 8);
  assert.deepEqual(attached.project.types, ["person", "organization", "place"]);
  await assert.rejects(
    run("coordinator", [
      "attach",
      "Conflicting coordinator",
      "--project",
      "fixture",
    ]),
    /Another coordinator/,
  );
  const searched = await run("coordinator", [
    "search",
    "Alex",
    "--session",
    sessionFile,
  ]);
  assert.ok(searched.hits.length);
  const entity = await command({
    action: "inspect",
    kind: "entity",
    table: "nodes",
    id: "alex",
  });
  assert.equal(entity.record.id, "alex");
  // The human sets a team of one; the coordinator opens a batch with a goal, and the
  // app starts the team.
  const settings = await fetch(`${url}/api/research-settings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ researchersPerBatch: 1 }) });
  assert.equal(settings.ok, true);
  const batchOpened = await command({
    action: "open-batch",
    engine: "claude",
    title: "Local workflow check",
    goal: "Local integration check only: inspect the Alex Example record, and perform no external research.",
    scope: ["imports"],
  });
  const id = batchOpened.investigationId;
  assert.deepEqual(batchOpened.researchers, ["Researcher 1"]);
  await assert.rejects(command({ action: "assign", investigationId: id, title: "A part", brief: "Look." }), /Unknown coordinator action/);
  // Its researcher saves a checkpoint and says it has finished: the batch reaches Review.
  const batch = async () => (await state()).investigations[0];
  const waitFor = async (check, what) => {
    for (let n = 0; n < 300; n++) {
      if (check(await batch())) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timed out waiting for ${what}: ${JSON.stringify(await batch(), null, 1).slice(0, 2000)}`);
  };
  await waitFor((b) => b.status === "review" && b.readyAt, "the batch to reach Review");
  assert.equal((await batch()).assignments[0].status, "finished");
  assert.equal((await batch()).assignments[0].checkpoints.length, 1);
  await command({
    action: "map",
    notes:
      "Purpose: local workflow verification. Relevant entity nodes/alex; no new historical research.",
  });
  await run("coordinator", ["detach", "--session", sessionFile]);
  await assert.rejects(
    command({ action: "map", notes: "late" }),
    /expired/,
  );
  const recovered = await run("coordinator", [
    "attach",
    "Replacement local coordinator",
    "--project",
    "fixture",
  ]);
  sessionFile = recovered.sessionFile;
  // The batch and its researcher's checkpoint are there for the next coordinator.
  assert.equal(recovered.investigations[0].assignments[0].checkpointCount, 1);
  assert.equal(recovered.investigations[0].ready, true);
  // Its post wakes the finished researcher, which takes it up and finishes again.
  await command({ action: "post", investigationId: id, text: "The human asks whether anything was missed." });
  await waitFor((b) => b.events.some((e) => e.message.includes("woke the team")) && b.status === "review", "the woken team to finish again");
  assert.equal((await batch()).board[0].author, "coordinator");
  await assert.rejects(
    command({
      action: "accept",
      investigationId: id,
      proposalId: "none",
    }),
    /cannot accept/,
  );
  // An old manual-worker credential cannot publish around the app.
  const worker = JSON.parse(
    readFileSync(join(directory, "projects/fixture/connection.json"), "utf8"),
  );
  const forbidden = await fetch(`${url}/api/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${worker.token}`,
    },
    body: JSON.stringify({ type: "claim", worker: "bypass" }),
  });
  assert.equal(forbidden.status, 409);
  // The human's word ends the work: the coordinator stops the batch's team.
  assert.deepEqual(await command({ action: "stop-team", investigationId: id, reason: "The human no longer wants this." }), { stopped: true });
  assert.deepEqual((await batch()).assignments.map((a) => a.status), ["stopped"]);
  await assert.rejects(command({ action: "post", investigationId: id, text: "Keep going." }), /team was stopped/);
  await run("coordinator", ["detach", "--session", sessionFile]);
  const pid = Number(
    readFileSync(join(directory, "projects/fixture/server.lock"), "utf8"),
  );
  process.kill(pid, "SIGTERM");
  await waitForExit(pid);
  const restarted = await run("workspace", ["open", "fixture", "--no-browser"]);
  url = restarted.url;
  const final = await state();
  assert.equal(final.investigations[0].stoppedAt !== undefined, true);
  assert.equal(final.investigations[0].assignments[0].checkpoints.length, 1);
  assert.equal(final.investigations[0].board.length, 1);
  await run("workspace", [
    "create",
    "second",
    resolve("tests/fixtures/workshop.json"),
    "Second independent project",
  ]);
  const second = await run("workspace", ["open", "second", "--no-browser"]);
  const secondState = await (await fetch(`${second.url}/api/state`)).json();
  assert.equal(secondState.investigations.length, 0);
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          "project discovery and reuse",
          "exclusive coordinator",
          "targeted context retrieval",
          "a team started on a new batch",
          "the done phrase, a waking post, and Review",
          "stopping a team",
          "restart persistence",
          "project isolation",
        ],
        directory,
        url,
      },
      null,
      2,
    ),
  );
} finally {
  for (const dir of [
    join(directory, "projects", "fixture"),
    join(directory, "projects", "second"),
  ]) {
    const lock = join(dir, "server.lock");
    if (existsSync(lock)) {
      try {
        const pid = Number(readFileSync(lock, "utf8"));
        process.kill(pid, "SIGTERM");
        await waitForExit(pid);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
  rmSync(directory, { recursive: true, force: true });
}
