import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { project, read, save } from "./workspace-lib.mjs";
import { snapshotView, printView, layered } from "./coordinator-view.mjs";
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
  {
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
    else if (action === "handoff" || action === "map")
      data.notes = readFileSync(values[0], "utf8");
    else if (action === "search") {
      data.query = values[0];
      data.offset = Number(values[1] || 0);
    } else if (action === "command") {
      const payload = JSON.parse(readFileSync(values[0], "utf8"));
      data = { ...payload, session: session.secret };
      if (data.action === "attach")
        throw new Error("Use the explicit attach command.");
    } else if (!["snapshot", "detach"].includes(action))
      throw new Error(
        "Commands: attach, snapshot, search <words>, map <text-file>, handoff <text-file>, command <json-file>, detach.",
      );
    const response = await fetch(`${connection.url}/api/coordinator`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${connection.token}`,
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(60_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    if (result && "project" in result && "revision" in result) {
      const snapshotFile = `${file}.snapshot.json`;
      // Until the layered context is switched on, the saved snapshot matches what was printed.
      if (!layered()) delete result.context;
      save(snapshotFile, result);
      save(file, session);
      const view = snapshotView(result, file, snapshotFile);
      // Attach output is read back by the workspace command, which prints it.
      if (action === "attach") console.log(JSON.stringify(view, null, 2));
      else printView(view);
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
