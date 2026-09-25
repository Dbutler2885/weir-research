import { streamActions } from "../live-activity.mjs";

// The oldest Codex whose app server this adapter was tested against. The app
// server is experimental, so an older one, or one whose protocol no longer
// answers the methods used here, is refused with a message naming the problem.
export const TESTED_CODEX = "0.155.1";
const MINIMUM = [0, 155, 0];
const METHOD_NOT_FOUND = -32601;

export class IncompatibleAgent extends Error {}

export function appServerVersion(userAgent) {
  const match = String(userAgent || "").match(/\/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map(Number) : null;
}

// Codex through its app server, over JSON-RPC on stdin and stdout. A thread is
// started once with the folder, sandbox, approval policy and model; each message
// then starts a turn, or steers the running turn.
export const codexAdapter = {
  args() {
    return ["app-server"];
  },
  session({ write, describe, folder, instructions = "", model = "", effort = "", web = false }) {
    let nextId = 0;
    const requests = new Map();
    let threadId = null;
    let turnId = null;
    let starting = false;
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
            throw new IncompatibleAgent(
              `Codex ${version ? version.join(".") : "of an unknown version"} is older than this app supports. Update Codex to ${TESTED_CODEX} or later.`,
            );
          write({ jsonrpc: "2.0", method: "initialized" });
          request(
            "thread/start",
            {
              cwd: folder,
              sandbox: "workspace-write",
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
            if (pending.method === "turn/interrupt") return { actions: [] };
            const reason =
              message.error.code === METHOD_NOT_FOUND
                ? `The Codex app server no longer supports ${pending.method}; this app was tested with Codex ${TESTED_CODEX}.`
                : `The Codex app server refused ${pending.method}: ${message.error.message}`;
            return { actions: [], failure: new IncompatibleAgent(reason) };
          }
          try {
            pending.then(message.result || {});
          } catch (error) {
            return { actions: [], failure: error };
          }
          return { actions: [] };
        }
        // A request from the app server, such as an approval; the app answers none.
        if (message.id !== undefined) {
          write({ jsonrpc: "2.0", id: message.id, error: { code: METHOD_NOT_FOUND, message: "Not supported by this app." } });
          return { actions: [] };
        }
        if (message.method === "turn/started") turnId = message.params.turn.id;
        if (message.method === "turn/completed") {
          turnId = null;
          flush();
          return { actions: [], turn: { ok: message.params.turn.status === "completed" } };
        }
        return { actions: streamActions(message, describe) };
      },
    };
  },
};

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
