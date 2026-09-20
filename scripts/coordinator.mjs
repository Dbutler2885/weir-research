import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { project, read, save } from "./workspace-lib.mjs";
import { snapshotView } from "./coordinator-view.mjs";
const args = process.argv.slice(2);
function option(name) {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  args.splice(at, 2);
  if (!value) throw new Error(`${name} requires a value.`);
  return value;
}
try {
  const sessionPath = option("--session");
  const projectId = option("--project");
  const [action, ...values] = args;
  let session, file;
  if (action === "attach") {
    const p = project(projectId);
    session = {
      directory: p.directory,
      secret: randomUUID(),
      cursor: -1,
      name: values[0] || "Research coordinator",
    };
    file = join(p.directory, "coordinator-sessions", `${session.secret}.json`);
  } else {
    if (!sessionPath)
      throw new Error(
        "Use --session <path returned by attach>. Each agent session must attach separately.",
      );
    file = resolve(sessionPath);
    session = read(file, null);
    if (!session) throw new Error("Coordinator session file not found.");
  }
  if (action === "ack") {
    const revision = Number(values[0]);
    if (
      !Number.isInteger(revision) ||
      revision < session.cursor ||
      revision > (session.lastRead ?? -1)
    )
      throw new Error(
        "Acknowledge only a revision already read by this session.",
      );
    session.cursor = revision;
    save(file, session);
    console.log(JSON.stringify({ acknowledged: revision }));
  } else {
    const connection = read(
      join(session.directory, "coordinator-connection.json"),
      null,
    );
    if (!connection)
      throw new Error(
        "Open this project with npm run workspace -- open first.",
      );
    let data = { action, session: session.secret };
    if (action === "attach") data.name = session.name;
    else if (action === "wait") {
      data.since = session.cursor;
      data.timeout = 300_000;
    } else if (action === "handoff" || action === "map")
      data.notes = readFileSync(values[0], "utf8");
    else if (action === "search") {
      data.query = values[0];
      data.offset = Number(values[1] || 0);
    } else if (action === "command") {
      const payload = JSON.parse(readFileSync(values[0], "utf8"));
      data = { ...payload, session: session.secret };
      if (["attach", "wait"].includes(data.action))
        throw new Error("Use the explicit attach/wait command.");
    } else if (!["snapshot", "detach"].includes(action))
      throw new Error(
        "Commands: attach, snapshot, wait, ack <revision>, handoff <text-file>, command <json-file>, detach.",
      );
    const response = await fetch(`${connection.url}/api/coordinator`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${connection.token}`,
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(310_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    if (result && ("unchanged" in result || "changed" in result)) {
      session.lastRead = result.revision;
      save(file, session);
      console.log(
        JSON.stringify(
          {
            revision: result.revision,
            acknowledged: session.cursor,
            ...(result.unchanged
              ? { status: "No change. Wait again." }
              : {
                  changed: result.changed,
                  instruction:
                    "Act on these changes, answer messages in the conversation, then acknowledge this revision and wait again. Use snapshot for the full project index.",
                }),
          },
          null,
          2,
        ),
      );
    } else if (result && "project" in result && "revision" in result) {
      const snapshotFile = `${file}.snapshot.json`;
      save(snapshotFile, result);
      session.lastRead = result.revision;
      save(file, session);
      console.log(JSON.stringify(snapshotView(result, file, snapshotFile, session.cursor), null, 2));
    } else {
      // Claims contain a private lease and a large brief; keep them on disk for deliberate delegation.
      if (result?.investigation?.lease) {
        const briefFile = `${file}.${result.investigation.id}.brief.json`;
        save(briefFile, result);
        console.log(
          JSON.stringify({
            briefFile,
            investigationId: result.investigation.id,
          }),
        );
      } else console.log(JSON.stringify(result, null, 2));
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
