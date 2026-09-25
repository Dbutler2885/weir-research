import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  root,
  projects,
  project,
  createProject,
  createTopicProject,
  openProject,
} from "./workspace-lib.mjs";
import { printView } from "./coordinator-view.mjs";
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
    const opened = await openProject(created, {
      browser: !args.includes("--no-browser") && !process.env.RESEARCH_NO_BROWSER,
    });
    const attached = JSON.parse(
      execFileSync(
        process.execPath,
        [
          join(root, "scripts/coordinator.mjs"),
          "attach",
          "Research coordinator",
          "--project",
          created.id,
        ],
        { encoding: "utf8" },
      ),
    );
    result = { url: opened.url, ...attached };
  } else if (command === "create") {
    if (args.length === 1) result = createTopicProject(args[0]);
    else if (args.length < 2)
      throw new Error(
        "Usage: workspace create <id> <dataset.json> [display name]",
      );
    else result = createProject(args[0], args[2] || args[0], args[1]);
  } else if (command === "open")
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
