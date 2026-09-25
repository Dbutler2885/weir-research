import { randomUUID } from "node:crypto";
import { streamActions } from "../live-activity.mjs";
import { claudeIsolationArgs } from "./isolation.mjs";

// Claude Code in print mode, speaking stream-json both ways with its input kept
// open. A message written mid-turn reaches it after its current tool step.
export const claudeAdapter = {
  // The agent is confined to its folder; web adds the web tools.
  args({ folder, instructions = "", model = "", effort = "", web = false }) {
    return [
      "--print",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "dontAsk",
      ...(model ? ["--model", model] : []),
      ...(effort ? ["--effort", effort] : []),
      ...claudeIsolationArgs(folder, { web }),
      ...(instructions ? ["--append-system-prompt", instructions] : []),
    ];
  },
  // One agent's conversation over its input and output.
  session({ write, describe }) {
    return {
      // A message starts a turn when the agent is waiting, or joins the running one.
      send(text) {
        write({ type: "user", message: { role: "user", content: text } });
      },
      interrupt() {
        write({ type: "control_request", request_id: randomUUID(), request: { subtype: "interrupt" } });
      },
      // The actions in one output event, and whether it ends a turn successfully.
      read(event) {
        const actions = streamActions(event, describe);
        if (event.type !== "result") return { actions };
        return { actions, turn: { ok: event.subtype === "success", text: typeof event.result === "string" ? event.result : "" } };
      },
    };
  },
};
