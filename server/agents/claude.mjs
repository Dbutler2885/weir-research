import { randomUUID } from "node:crypto";
import { streamActions } from "../live-activity.mjs";
import { claudeIsolationArgs } from "./isolation.mjs";

// Claude Code's rate-limit report: whether the limit is reached, when it resets,
// and how much of each window is used.
export function claudeUsage(info) {
  const windows = Object.entries(info.unifiedWindows || {}).map(([name, w]) => ({
    name: name === "five_hour" ? "5-hour" : name === "seven_day" ? "weekly" : name.replace(/_/g, " "),
    used: w.utilization,
    resetsAt: w.resetsAt ? w.resetsAt * 1000 : null,
  }));
  return {
    exhausted: info.status === "rejected",
    resetsAt: info.resetsAt ? info.resetsAt * 1000 : null,
    windows,
  };
}

// Claude Code in print mode, speaking stream-json both ways with its input kept
// open. A message written mid-turn reaches it after its current tool step.
export const claudeAdapter = {
  // The agent is confined to its folder; web adds the web tools.
  args({ folder, instructions = "", model = "", effort = "", web = false, browser = null }) {
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
      ...claudeIsolationArgs(folder, { web, browser }),
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
      // The actions in one output event, its report of usage, and whether it ends a
      // turn successfully or because the usage limit was reached.
      read(event) {
        const actions = streamActions(event, describe);
        if (event.type === "rate_limit_event") return { actions, usage: claudeUsage(event.rate_limit_info || {}) };
        if (event.type !== "result") return { actions };
        // A turn stopped by the usage limit reports success with an error flag and HTTP 429.
        const quota = event.is_error === true && event.api_error_status === 429;
        return { actions, turn: { ok: event.subtype === "success" && !event.is_error, quota, text: typeof event.result === "string" ? event.result : "" } };
      },
    };
  },
};
