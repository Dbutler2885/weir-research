import { randomUUID } from "node:crypto";
import { streamActions } from "../live-activity.mjs";

// Claude Code in print mode, speaking stream-json both ways with its input kept
// open. A message written mid-turn reaches it after its current tool step.
export const claudeAdapter = {
  // Flags are extra Claude options a role needs, such as narrowing its tool set.
  args({ instructions, tools, flags = [], model, effort }) {
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
      ...(tools ? ["--allowedTools", tools.join(",")] : []),
      ...(instructions ? ["--append-system-prompt", instructions] : []),
      ...flags,
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
        return { actions, turn: { ok: event.subtype === "success" } };
      },
    };
  },
};
