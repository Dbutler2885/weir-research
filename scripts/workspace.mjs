import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import {
  home,
  projects,
  project,
  stopProject,
  runningWorkers,
  createProject,
  createTopicProject,
  openProject,
} from "./workspace-lib.mjs";
import { printView } from "./coordinator-view.mjs";
import { agentHomes } from "../server/agents/isolation.mjs";
const [command, ...args] = process.argv.slice(2);
try {
  let result;
  if (command === "projects") result = projects();
  else if (command === "start" || command === "resume") {
    const topic = args.find((a) => !a.startsWith("--"));
    if (command === "start" && !topic)
      throw new Error("What would you like to research?");
    const created =
      command === "start" ? createTopicProject(topic) : project(topic);
    // The app starts its own coordinator for the project it opens.
    const opened = await openProject(created, {
      browser: !args.includes("--no-browser") && !process.env.RESEARCH_NO_BROWSER,
    });
    result = { url: opened.url, project: { id: created.id, name: created.name } };
  } else if (command === "create") {
    if (args.length === 1) result = createTopicProject(args[0]);
    else if (args.length < 2)
      throw new Error(
        "Usage: workspace create <id> <dataset.json> [display name]",
      );
    else result = createProject(args[0], args[2] || args[0], args[1]);
  } else if (command === "sign-in") {
    // Codex agents use the app's own Codex home; this runs Codex's own sign-in for it.
    if (args[0] !== "codex") throw new Error("Usage: workspace sign-in codex");
    const homes = agentHomes(home);
    const login = spawnSync("codex", ["login"], {
      stdio: "inherit",
      env: { ...process.env, CODEX_HOME: homes.codexHome, HOME: homes.home },
    });
    if (login.error || login.status !== 0) throw new Error("Codex sign-in did not complete.");
    process.exit(0);
  } else if (command === "stop") {
    // Workers that are running can be kept running after the app closes; ask when unsaid.
    const p = project(args.find((a) => !a.startsWith("--")));
    let keepWorkers = args.includes("--keep-workers");
    const running = runningWorkers(p);
    if (running && !keepWorkers && !args.includes("--stop-workers") && process.stdin.isTTY) {
      const ask = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await ask.question(`${running === 1 ? "A worker is" : `${running} workers are`} still running. Keep ${running === 1 ? "it" : "them"} running after the app closes? (y/N) `);
      ask.close();
      keepWorkers = /^y/i.test(answer.trim());
    }
    result = { ...(await stopProject(p, { keepWorkers })), keptWorkers: keepWorkers ? running : 0 };
  }
  else if (command === "open")
    result = await openProject(project(args.find((a) => !a.startsWith("--"))), {
      browser: !args.includes("--no-browser") && !process.env.RESEARCH_NO_BROWSER,
    });
  else
    result = {
      commands: [
        'start "research topic" [--no-browser]',
        "resume [project-id] [--no-browser]",
        "projects",
        "open [project-id] [--no-browser]",
        "stop [project-id] [--keep-workers | --stop-workers]",
        "sign-in codex (sign in the app's own Codex home)",
        'create "research topic"',
        "create <id> <dataset.json> [display name] (existing dataset import)",
      ],
      note: "Projects include their dataset, sources, investigations, and review history. Start from a topic with no records. Existing structured datasets can also be imported.",
    };
  printView(result);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
