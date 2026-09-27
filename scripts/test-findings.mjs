// End-to-end protocol test with fictional material. No model provider is invoked.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
mkdirSync(".research/development", { recursive: true });
const directory = mkdtempSync(resolve(".research/development/review-"));
const child = spawn(process.execPath, ["server/main.mjs"], {
  // The test drives the worker API itself, so the app starts no coordinator agent.
  env: { ...process.env, RESEARCH_STATE_DIR: directory, RESEARCH_PORT: "0", RESEARCH_COORDINATOR_AGENT: "0" },
  stdio: "pipe",
});
let logs = "";
child.stderr.on("data", (d) => (logs += d));
const closed = new Promise((resolve) => child.on("close", resolve));
let url, token;
const post = async (data, worker = false, ok = true) => {
  const r = await fetch(`${url}/api/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(worker ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
  });
  const b = await r.json();
  assert.equal(r.ok, ok, JSON.stringify(b));
  return b.result;
};
const state = async () => await (await fetch(`${url}/api/state`)).json();
try {
  for (let n = 0; !existsSync(join(directory, "connection.json")); n++) {
    if (n > 200) throw new Error(`Server did not start: ${logs}`);
    await new Promise((r) => setTimeout(r, 25));
  }
  ({ url, token } = JSON.parse(
    readFileSync(join(directory, "connection.json"), "utf8"),
  ));
  const { investigationId } = await post({
    type: "annotate",
    question: "Who worked at the fictional workshop, and when did it open?",
    dispatch: true,
  });
  let lease = (
    await post(
      {
        type: "claim",
        investigationId,
        worker: "Fictional fixture researcher",
      },
      true,
    )
  ).investigation.lease;
  const evidence = [
    {
      id: "entry",
      sourceId: "fictional-register",
      quote: "Alex worked at Example Workshop.",
      context: "A fictional register for testing.",
      locator: "Entry 1",
      interpretation:
        "The register reports employment.\n\nIt gives no opening date.",
      stance: "supports",
    },
  ];
  const { proposalId } = await post(
    {
      type: "propose",
      investigationId,
      token: lease.token,
      proposal: {
        kind: "findings",
        title: "A worker and an unresolved date",
        summary:
          "The register reports a worker at the workshop.\n\nThe opening date remains unresolved.",
        ambiguity: "A single attributed account; the date is unknown.",
        sources: [
          {
            id: "fictional-register",
            title: "Fictional workshop register",
            access: "full-text",
            note: "Invented testing material, not historical evidence.",
          },
        ],
        evidence,
        changes: [],
        findings: [
          {
            id: "employment",
            statement:
              "The register reports that Alex worked at Example Workshop.",
            qualification: "reported",
            explanation:
              "This preserves the register’s attribution.\n\nIt is not independent confirmation.",
            evidenceIds: ["entry"],
          },
          {
            id: "date",
            statement: "The workshop opening date remains unknown.",
            qualification: "unresolved",
            explanation: "The register does not supply a date.",
            evidenceIds: [],
          },
        ],
      },
    },
    true,
  );
  assert.equal((await state()).dataset.people.length, 0);
  await post(
    {
      type: "finding-decision",
      investigationId,
      proposalId,
      findingId: "employment",
      decision: "kept",
    },
    true,
    false,
  );
  await post({
    type: "finding-decision",
    investigationId,
    proposalId,
    findingId: "employment",
    decision: "kept",
  });
  const refs = [{ proposalId, findingId: "employment" }];
  await post({ type: "build-graph", investigationId, refs });
  lease = (
    await post(
      { type: "claim", investigationId, worker: "Fictional graph builder" },
      true,
    )
  ).investigation.lease;
  const { proposalId: graphId } = await post(
    {
      type: "propose",
      investigationId,
      token: lease.token,
      proposal: {
        kind: "graph",
        title: "Represent the reported employment",
        summary:
          "Introduce the named worker and workplace, then their attributed relationship.",
        ambiguity: "This remains a single-source attribution.",
        omissions: "Opening date remains a finding; no graph date is proposed.",
        evidence,
        changes: [
          {
            table: "people",
            recordId: "alex",
            before: null,
            after: {
              id: "alex",
              name: "Alex Example",
              sourceIds: ["fictional-register"],
            },
            reason: "The register names this worker.",
            evidenceIds: ["entry"],
          },
          {
            table: "contextEntities",
            recordId: "workshop",
            before: null,
            after: {
              id: "workshop",
              name: "Example Workshop",
              kind: "organization",
              sourceIds: ["fictional-register"],
            },
            reason: "The named workplace.",
            evidenceIds: ["entry"],
          },
          {
            table: "claims",
            recordId: "employment",
            before: null,
            after: {
              id: "employment",
              subjectId: "alex",
              predicate: "reported_employment",
              object: { entityId: "workshop" },
              qualification: "reported",
              time: null,
              reasoning: "Attributed by one register entry.",
              evidence: [],
              sourceIds: ["fictional-register"],
            },
            reason: "Preserve the attribution as a qualified relationship.",
            evidenceIds: ["entry"],
          },
        ],
        groups: [
          {
            id: "entities",
            title: "Worker and workplace",
            changeIndexes: [0, 1],
            findingRefs: refs,
            dependsOn: [],
          },
          {
            id: "relationship",
            title: "Reported employment relationship",
            changeIndexes: [2],
            findingRefs: refs,
            dependsOn: ["entities"],
          },
        ],
      },
    },
    true,
  );
  await post(
    {
      type: "apply-groups",
      investigationId,
      proposalId: graphId,
      groupIds: ["relationship"],
    },
    false,
    false,
  );
  if (process.env.REVIEW_BROWSER_FIXTURE === "1") {
    console.log(
      JSON.stringify({ url, directory, investigationId, proposalId, graphId }),
    );
    await closed;
  } else {
    await post({
      type: "apply-groups",
      investigationId,
      proposalId: graphId,
      groupIds: ["entities"],
    });
    assert.equal((await state()).dataset.claims.length, 0);
    await post({
      type: "apply-groups",
      investigationId,
      proposalId: graphId,
      groupIds: ["relationship"],
    });
    assert.equal((await state()).dataset.claims.length, 1);
    const before = (await state()).investigations[0].annotations.length;
    await post({
      type: "interface-feedback",
      question: "Make this label clearer",
      references: [],
    });
    assert.equal((await state()).investigations[0].annotations.length, before);
    await post({
      type: "annotate",
      investigationId,
      question: "Locate a second source",
      dispatch: true,
    });
    lease = (
      await post(
        { type: "claim", investigationId, worker: "Access fixture" },
        true,
      )
    ).investigation.lease;
    await post(
      {
        type: "checkpoint",
        investigationId,
        token: lease.token,
        summary: "Original requires access",
        findings: "Catalog metadata only",
        nextSteps: "Human can import a copy",
        accessRequest: {
          instruction: "Import the original document in Sources.",
        },
      },
      true,
    );
    assert.equal((await state()).investigations[0].status, "paused");
    await post({ type: "resolve-access", investigationId });
    assert.equal((await state()).investigations[0].status, "queued");
    console.log(
      "Findings, graph review, human-only decisions, interface feedback, and access recovery passed.",
    );
  }
} finally {
  child.kill("SIGTERM");
  await closed;
  if (process.env.REVIEW_BROWSER_FIXTURE !== "1")
    rmSync(directory, { recursive: true, force: true });
}
