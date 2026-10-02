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
// Researchers are a stand-in Claude CLI that saves a checkpoint and returns an unresolved result.
const steps = join(directory, "researcher-steps.json");
writeFileSync(
  steps,
  JSON.stringify([
    {
      tool: "Write",
      input: { file_path: "checkpoint.json" },
      writes: { "checkpoint.json": JSON.stringify({ summary: "Local checkpoint", findings: "Inspected the existing record only.", nextSteps: "Preserve an unresolved outcome." }) },
    },
    {
      tool: "Write",
      input: { file_path: "result.json" },
      writes: { "result.json": JSON.stringify({ title: "Local workflow verified", summary: "This is a protocol test, not a new historical finding.", ambiguity: "The historical question remains uninvestigated.", evidence: [], changes: [] }) },
    },
  ]),
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
const browser = async (data) => {
  const response = await fetch(`${url}/api/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  assert.equal(response.ok, true, JSON.stringify(result));
  return result;
};
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
  const annotated = await browser({
    type: "annotate",
    question:
      "Local protocol test: inspect this identity without adding historical claims.",
    target: {
      label: "Alex Example",
      table: "nodes",
      recordId: "alex",
    },
    dispatch: true,
  });
  const id = annotated.result.investigationId;
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
  await command({
    action: "assign",
    investigationId: id,
    engine: "claude",
    brief: "Local integration check only. Record an unresolved outcome; perform no external research.",
  });
  // The app launches the researcher; its result waits for the coordinator.
  let candidate;
  for (let n = 0; n < 200 && !candidate; n++) {
    await new Promise((r) => setTimeout(r, 100));
    candidate = (await run("coordinator", ["snapshot", "--session", sessionFile])).candidates[0];
  }
  assert.equal(candidate.title, "Local workflow verified");
  assert.equal((await state()).investigations[0].checkpoints.length, 1);
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
  // The researcher's result is still there for the next coordinator to publish.
  assert.equal(recovered.investigations[0].checkpointCount, 1);
  assert.equal(recovered.candidates[0].id, candidate.id);
  const published = await command({
    action: "publish",
    investigationId: id,
    candidateId: candidate.id,
  });
  assert.equal((await state()).investigations[0].status, "review");
  await assert.rejects(
    command({
      action: "accept",
      investigationId: id,
      proposalId: published.proposalId,
    }),
    /cannot accept/,
  );
  // An old manual-worker credential cannot bypass coordinating synthesis.
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
  await browser({
    type: "accept",
    investigationId: id,
    proposalId: published.proposalId,
  });
  await run("coordinator", ["detach", "--session", sessionFile]);
  const pid = Number(
    readFileSync(join(directory, "projects/fixture/server.lock"), "utf8"),
  );
  process.kill(pid, "SIGTERM");
  await waitForExit(pid);
  const restarted = await run("workspace", ["open", "fixture", "--no-browser"]);
  url = restarted.url;
  const final = await state();
  assert.equal(final.investigations[0].proposals[0].status, "accepted");
  assert.equal(final.investigations[0].checkpoints.length, 1);
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
          "researcher checkpoint and recovery",
          "coordinator-only synthesis",
          "human-only acceptance",
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
