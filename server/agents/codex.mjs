import { streamActions } from "../live-activity.mjs";
import { AgentProblem } from "./problem.mjs";
import { codexIsolationArgs } from "./isolation.mjs";

// The oldest Codex whose app server this adapter was tested against. The app
// server is experimental, so an older one, or one whose protocol no longer
// answers the methods used here, is refused with a message naming the problem.
export const TESTED_CODEX = "0.155.1";
const MINIMUM = [0, 155, 0];
const METHOD_NOT_FOUND = -32601;


export function appServerVersion(userAgent) {
  const match = String(userAgent || "").match(/\/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map(Number) : null;
}

// Codex through its app server, over JSON-RPC on stdin and stdout. A thread is
// started once with the folder, sandbox, approval policy and model; each message
// then starts a turn, or steers the running turn.
export const codexAdapter = {
  /** @param {{folder: string, browser?: {command: string, args: string[], env?: Record<string, string>} | null, compactAt?: number}} options */
  args({ folder, browser = null, compactAt = 0 }) {
    return ["app-server", ...codexIsolationArgs(folder, { browser, compactAt })];
  },
  // Codex agents use the app's own Codex home and home folder, never the human's.
  env(base, { homes }) {
    return homes ? { ...base, CODEX_HOME: homes.codexHome, HOME: homes.home } : base;
  },
  // resume picks up an earlier thread by its ID instead of starting one.
  session({ write, describe, folder, instructions = "", model = "", effort = "", web = false, resume = "" }) {
    let nextId = 0;
    const requests = new Map();
    let threadId = null;
    let turnId = null;
    let starting = false;
    // The agent's latest reply, which ends its turn.
    let reply = "";
    // Codex reports each of its limits separately; one report never replaces another's.
    const limits = new Map();
    const waiting = [];
    const request = (method, params, then = () => {}) => {
      const id = ++nextId;
      requests.set(id, { method, params, then });
      write({ jsonrpc: "2.0", id, method, params });
    };
    const input = (text) => [{ type: "text", text, text_elements: [] }];
    const startTurn = (text) => {
      starting = true;
      request("turn/start", { threadId, input: input(text), ...(effort ? { effort } : {}) }, (result) => {
        starting = false;
        turnId ??= result.turn.id;
        flush();
      });
    };
    const steer = (text) =>
      request("turn/steer", { threadId, expectedTurnId: turnId, input: input(text) });
    function flush() {
      while (waiting.length && threadId && !starting) {
        const text = waiting.shift();
        if (turnId) steer(text);
        else startTurn(text);
      }
    }
    return {
      open() {
        request("initialize", { clientInfo: { name: "research-workspace", title: null, version: "1" }, capabilities: null }, (result) => {
          const version = appServerVersion(result.userAgent);
          if (!version || compare(version, MINIMUM) < 0)
            throw new AgentProblem(
              `Codex ${version ? version.join(".") : "of an unknown version"} is older than this app supports. Update Codex to ${TESTED_CODEX} or later.`,
            );
          write({ jsonrpc: "2.0", method: "initialized" });
          request("account/read", {}, (status) => {
            if (!status.account && status.requiresOpenaiAuth)
              throw new AgentProblem("Codex is not signed in for this app. Sign in with `npm run workspace -- sign-in codex`, then try again.");
          });
          request(
            resume ? "thread/resume" : "thread/start",
            {
              ...(resume ? { threadId: resume } : {}),
              // No sandbox mode here: it would replace the folder's permission profile.
              cwd: folder,
              approvalPolicy: "never",
              ...(model ? { model } : {}),
              ...(instructions ? { developerInstructions: instructions } : {}),
              config: { web_search: web ? "live" : "disabled" },
            },
            (thread) => {
              threadId = thread.thread.id;
              flush();
            },
          );
        });
      },
      // A message starts a turn when the agent is waiting, or steers the running one.
      send(text) {
        waiting.push(text);
        flush();
      },
      // Idle once started and between turns, with nothing waiting to be sent.
      idle() {
        return Boolean(threadId) && !turnId && !starting && !waiting.length;
      },
      interrupt() {
        if (threadId && turnId) request("turn/interrupt", { threadId, turnId });
      },
      // Asks whether the usage limit still holds, without starting a turn.
      limitLifted() {
        request("account/rateLimits/read", undefined);
      },
      // The app server's own compaction request.
      compact() {
        if (threadId) request("thread/compact/start", { threadId });
      },
      read(message) {
        // A response to one of this adapter's requests.
        if (message.id !== undefined && !message.method) {
          const pending = requests.get(message.id);
          requests.delete(message.id);
          if (!pending) return { actions: [] };
          if (message.error) {
            // The turn ended just before the steer reached it; start the next one instead.
            if (pending.method === "turn/steer") {
              turnId = null;
              waiting.unshift(pending.params.input[0].text);
              flush();
              return { actions: [] };
            }
            // A question the app can ask again later is no reason to stop.
            if (pending.method === "turn/interrupt" || pending.method === "account/rateLimits/read") return { actions: [] };
            const reason =
              message.error.code === METHOD_NOT_FOUND
                ? `The Codex app server no longer supports ${pending.method}; this app was tested with Codex ${TESTED_CODEX}.`
                : `The Codex app server refused ${pending.method}: ${message.error.message}`;
            return { actions: [], failure: new AgentProblem(reason) };
          }
          try {
            pending.then(message.result || {});
          } catch (error) {
            return { actions: [], failure: error };
          }
          // The thread's ID, by which it can be picked up again.
          if (pending.method === "thread/start" || pending.method === "thread/resume") return { actions: [], session: threadId };
          // Codex says whether ordinary usage is allowed again; its percentages and reset
          // times are not to be read as recovery.
          if (pending.method === "account/rateLimits/read") {
            for (const report of Object.values(message.result?.rateLimitsByLimitId || {})) limits.set(report.limitId ?? "codex", report);
            return { actions: [], ...(limits.size ? { usage: codexUsage(...limits.values()) } : {}), allowed: message.result?.ordinaryUsageAllowed === true };
          }
          return { actions: [] };
        }
        // A request from the app server, such as an approval; the app answers none.
        if (message.id !== undefined) {
          write({ jsonrpc: "2.0", id: message.id, error: { code: METHOD_NOT_FOUND, message: "Not supported by this app." } });
          return { actions: [] };
        }
        if (message.method === "turn/started") {
          turnId = message.params.turn.id;
          reply = "";
        }
        if (message.method === "item/completed" && message.params?.item?.type === "agentMessage") reply = message.params.item.text || "";
        if (message.method === "account/rateLimits/updated") {
          const report = message.params.rateLimits || {};
          limits.set(report.limitId ?? "codex", report);
          return { actions: [], usage: codexUsage(...limits.values()) };
        }
        // How full its context is: the last response's tokens, and the model's window.
        if (message.method === "thread/tokenUsage/updated") {
          const usage = message.params.tokenUsage || {};
          return { actions: [], context: { tokens: usage.last?.totalTokens ?? null, window: usage.modelContextWindow ?? null } };
        }
        if (message.method === "thread/compacted") return { actions: [], compacted: { before: null, after: null } };
        if (message.method === "turn/completed") {
          turnId = null;
          flush();
          const failure = message.params.turn.error?.codexErrorInfo;
          const quota = failure === "usageLimitExceeded" || failure === "rateLimitExceeded";
          const resetsAt = quota ? retryTime(message.params.turn.error?.message) : null;
          return { actions: [], turn: { ok: message.params.turn.status === "completed", quota, text: reply, ...(resetsAt ? { resetsAt } : {}) } };
        }
        return { actions: streamActions(message, describe) };
      },
    };
  },
};

// Codex's rate-limit reports: how much of each window is used, and when it resets.
export function codexUsage(...reports) {
  const windows = reports.flatMap((limits) => [limits.primary, limits.secondary]).filter(Boolean).map((w) => ({
    name: !w.windowDurationMins ? "usage" : w.windowDurationMins % 1440 === 0 ? (w.windowDurationMins === 10080 ? "weekly" : `${w.windowDurationMins / 1440}-day`) : `${Math.round(w.windowDurationMins / 60)}-hour`,
    used: w.usedPercent / 100,
    resetsAt: w.resetsAt ? w.resetsAt * 1000 : null,
  }));
  const full = windows.filter((w) => w.used >= 1);
  return {
    exhausted: reports.some((limits) => limits.rateLimitReachedType) || full.length > 0,
    resetsAt: full.length ? Math.max(...full.map((w) => w.resetsAt || 0)) || null : null,
    windows,
  };
}

// The reset a usage-limit error names, in local time: "try again at Sep 30th, 2026 12:06 AM."
// or, when it is soon, only "try again at 12:06 AM.", the next time the clock shows it.
export function retryTime(message, now = Date.now()) {
  const match = String(message || "").match(/try again at (?:([A-Z][a-z]{2}) (\d{1,2})(?:st|nd|rd|th)?, (\d{4}) )?(\d{1,2}):(\d{2}) ([AP]M)/);
  if (!match) return null;
  const [, month, day, year, hour, minute, half] = match;
  const hours = (Number(hour) % 12) + (half === "PM" ? 12 : 0);
  if (!month) {
    const at = new Date(now);
    at.setHours(hours, Number(minute), 0, 0);
    if (at.getTime() <= now) at.setDate(at.getDate() + 1);
    return at.getTime();
  }
  const index = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(month);
  if (index < 0) return null;
  return new Date(Number(year), index, Number(day), hours, Number(minute)).getTime();
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
