// Exercise topic-only startup and live organization without launching researchers.
import assert from "node:assert/strict";
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
const exec = promisify(execFile);
const directory = mkdtempSync(join(tmpdir(), "research-start-e2e-"));
// The test drives the coordinator API itself, so the app starts no coordinator agent.
const env = { ...process.env, RESEARCH_HOME: directory, RESEARCH_COORDINATOR_AGENT: "0" };
const run = async (script, args) =>
  JSON.parse(
    (
      await exec(
        process.execPath,
        [resolve(`scripts/${script}.mjs`), ...args],
        { env, maxBuffer: 5_000_000 },
      )
    ).stdout,
  );
let sessionFile, url;
const state = async () => (await fetch(`${url}/api/state`)).json();
const post = async (path, data) => {
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body;
};
try {
  const started = await run("workspace", [
    "start",
    "Lubec, Maine industrial history",
    "--no-browser",
  ]);
  ({ url } = started);
  assert.equal(started.project.name, "Lubec, Maine industrial history");
  ({ sessionFile } = await run("coordinator", ["attach", "Test coordinator", "--project", started.project.id]));
  assert.ok(sessionFile);
  let current = await state();
  assert.equal(current.dataset.title, "Lubec, Maine industrial history");
  assert.equal(current.dataset.initialFocusId, null);
  assert.deepEqual(current.dataset.people, []);
  assert.deepEqual(current.dataset.contextEntities, []);
  assert.deepEqual(current.dataset.sources, []);
  const annotation = await post("/api/commands", {
    type: "annotate",
    target: { label: current.dataset.title, text: current.dataset.title },
    question: "Which industries should I investigate?",
    dispatch: true,
  });
  const investigationId = annotation.result.investigationId;
  const preview = await post("/api/organization", {
    action: "organization-preview",
    seed: { name: "Lubec, Maine", kind: "place" },
  });
  assert.equal((await state()).dataset.contextEntities.length, 0);
  await post("/api/organization", {
    action: "organization-apply",
    previewId: preview.id,
  });
  current = await state();
  const lubec = current.dataset.contextEntities[0];
  assert.equal(lubec.kind, "place");
  assert.equal(current.dataset.initialFocusId, lubec.id);
  assert.equal(
    current.investigations.find((i) => i.id === investigationId).status,
    "paused",
  );
  const second = await post("/api/organization", {
    action: "organization-preview",
    seed: { name: "A company to investigate", kind: "organization" },
  });
  await post("/api/organization", {
    action: "organization-apply",
    previewId: second.id,
  });
  const commandFile = join(directory, "command.json");
  writeFileSync(
    commandFile,
    JSON.stringify({
      action: "organization-preview",
      keepIds: [lubec.id],
      reason: "Keep only Lubec",
    }),
  );
  const trim = await run("coordinator", [
    "command",
    commandFile,
    "--session",
    sessionFile,
  ]);
  writeFileSync(
    commandFile,
    JSON.stringify({ action: "organization-apply", previewId: trim.id }),
  );
  const applied = await run("coordinator", [
    "command",
    commandFile,
    "--session",
    sessionFile,
  ]);
  assert.equal((await state()).dataset.contextEntities.length, 1);
  await post("/api/organization", {
    action: "organization-undo",
    undoId: applied.undoId,
  });
  current = await state();
  assert.equal(current.dataset.contextEntities.length, 2);
  assert.equal(current.investigations.length, 1);
  assert.ok(current.organization.history.every((h) => !h.before));
  await run("coordinator", ["detach", "--session", sessionFile]);
  const resumed = await run("workspace", ["resume", "--no-browser"]);
  assert.equal(resumed.url, url);
  ({ sessionFile } = await run("coordinator", ["attach", "Test coordinator", "--project", resumed.project.id]));
  assert.equal((await state()).dataset.contextEntities.length, 2);
  await run("coordinator", ["detach", "--session", sessionFile]);
  sessionFile = undefined;
  const duplicate = await run("workspace", [
    "create",
    "Lubec, Maine industrial history",
  ]);
  assert.equal(duplicate.id, "lubec-maine-industrial-history-2");
  assert.equal((await state()).dataset.contextEntities.length, 2);
  console.log(
    "Topic startup, empty annotation, place focus, live trim/undo, coordinator commands, resume and topic collision: passed.",
  );
} finally {
  if (sessionFile)
    await run("coordinator", ["detach", "--session", sessionFile]).catch(
      () => {},
    );
  const lock = join(
    directory,
    "projects",
    "lubec-maine-industrial-history",
    "server.lock",
  );
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8"));
    process.kill(pid, "SIGTERM");
    for (let n = 0; n < 100 && existsSync(lock); n++)
      await new Promise((r) => setTimeout(r, 50));
    assert.equal(
      existsSync(lock),
      false,
      "Temporary service must stop before cleanup",
    );
  }
  rmSync(directory, { recursive: true, force: true });
}
