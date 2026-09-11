#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const directory = resolve(process.env.RESEARCH_STATE_DIR || ".research");
const connection = JSON.parse(
  readFileSync(resolve(directory, "connection.json"), "utf8"),
);
const [command, ...args] = process.argv.slice(2);
async function post(data) {
  const response = await fetch(`${connection.url}/api/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${connection.token}`,
    },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result.result;
}
try {
  if (command === "claim")
    console.log(
      JSON.stringify(
        await post({
          type: "claim",
          worker: args[0] || "research-agent",
          ...(args[1] ? { investigationId: args[1] } : {}),
        }),
        null,
        2,
      ),
    );
  else if (command === "checkpoint" || command === "propose") {
    const payload = JSON.parse(readFileSync(args[0], "utf8"));
    console.log(
      JSON.stringify(await post({ ...payload, type: command }), null, 2),
    );
  } else if (command === "status") {
    const response = await fetch(`${connection.url}/api/state`);
    const state = await response.json();
    console.log(
      JSON.stringify(
        state.investigations.map(
          ({ id, title, status, checkpoints, annotations }) => ({
            id,
            title,
            status,
            checkpoints: checkpoints.length,
            annotations: annotations.length,
          }),
        ),
        null,
        2,
      ),
    );
  } else {
    console.log(
      "research status\nresearch claim <worker-name> [investigation-id]\nresearch checkpoint <payload.json>\nresearch propose <payload.json>\n\nRead docs/research-agent.md before claiming work. Workers cannot accept proposals.",
    );
    if (command) process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
