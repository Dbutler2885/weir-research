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
  // compactAt is the context size, in tokens, at which Claude Code compacts on its own.
  // resume picks up an earlier conversation by its session ID.
  args({ folder, instructions = "", model = "", effort = "", web = false, browser = null, compactAt = 0, resume = "", readOnly = [] }) {
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
      ...(resume ? ["--resume", resume] : []),
      ...claudeIsolationArgs(folder, { web, browser, compactAt, readOnly }),
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
      // Claude Code compacts its conversation when sent /compact.
      compact() {
        write({ type: "user", message: { role: "user", content: "/compact" } });
      },
      // The actions in one output event, its report of usage, and whether it ends a
      // turn successfully or because the usage limit was reached.
      read(event) {
        const actions = streamActions(event, describe);
        // The conversation's ID, by which it can be picked up again.
        if (event.type === "system" && event.subtype === "init" && event.session_id) return { actions, session: event.session_id };
        if (event.type === "rate_limit_event") return { actions, usage: claudeUsage(event.rate_limit_info || {}) };
        // How full its context is, read from each reply's usage.
        const used = event.type === "assistant" && event.message?.usage;
        if (used) {
          const tokens = (used.input_tokens || 0) + (used.cache_read_input_tokens || 0) + (used.cache_creation_input_tokens || 0) + (used.output_tokens || 0);
          return { actions, context: { tokens } };
        }
        if (event.type === "system" && event.subtype === "compact_boundary")
          return { actions, compacted: { before: event.compact_metadata?.pre_tokens ?? null, after: event.compact_metadata?.post_tokens ?? null } };
        if (event.type !== "result") return { actions };
        // A turn stopped by the usage limit reports success with an error flag and HTTP 429.
        const quota = event.is_error === true && event.api_error_status === 429;
        // The model's context window, where the result reports it.
        const window = Object.values(event.modelUsage || {}).map((m) => m.contextWindow).find(Boolean) || null;
        return { actions, turn: { ok: event.subtype === "success" && !event.is_error, quota, text: typeof event.result === "string" ? event.result : "" }, ...(window ? { context: { window } } : {}) };
      },
    };
  },
};
