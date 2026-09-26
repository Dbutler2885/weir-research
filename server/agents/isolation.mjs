import { cpSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Every agent works confined to its own folder, with network access, and
// without the human's personal agent setup. Each CLI's own sandbox enforces
// this; the settings below are the ones tested against Claude Code 2.1.282 and
// Codex 0.155.1 on 2026-09-25.

// The Node binary running the app, so an agent's shell can run node scripts
// without being able to read the rest of the human's home folder.
const node = () => realpathSync(process.execPath);

// Claude Code: sandboxed Bash that cannot read the human's home folder except
// the agent's own folder, and permission rules keeping its file tools there.
export function claudeSettings(folder, { web = true, browser = null, compactAt = 0 } = {}) {
  const own = realpathSync(folder);
  return {
    // The context size at which it compacts on its own, when the human set one.
    ...(compactAt ? { autoCompactWindow: compactAt } : {}),
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      filesystem: { denyRead: [homedir()], allowRead: [own, node()], allowWrite: [own] },
      network: { allowedDomains: ["*"] },
    },
    permissions: {
      allow: ["Bash", `Read(/${own}/**)`, `Edit(/${own}/**)`, ...(web ? ["WebSearch", "WebFetch"] : []), ...(browser ? ["mcp__browser"] : [])],
      // Only the app starts agents, so every one of them is in the live panel.
      deny: ["Agent", "Task"],
    },
  };
}

// Claude Code loads only the folder's settings, instructions and skills, and no MCP
// servers but the research browser when the agent has one.
export function claudeIsolationArgs(folder, options = {}) {
  return [
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify({ mcpServers: options.browser ? { browser: options.browser } : {} }),
    "--settings",
    JSON.stringify(claudeSettings(folder, options)),
  ];
}

// Codex: a permission profile that reads only minimal system files and writes
// only the agent's folder, with network access. Its homes are the app's own,
// so it never loads the human's instructions, skills, hooks or MCP servers.
export function codexIsolationArgs(folder, { browser = null, compactAt = 0 } = {}) {
  const own = realpathSync(folder);
  // The research browser's MCP server, which Codex starts outside the sandbox.
  const mcp = browser
    ? [
        "-c",
        `mcp_servers.browser.command=${JSON.stringify(browser.command)}`,
        "-c",
        `mcp_servers.browser.args=${JSON.stringify(browser.args)}`,
        "-c",
        `mcp_servers.browser.env={${Object.entries(browser.env || {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}}`,
      ]
    : [];
  return [
    ...mcp,
    ...(compactAt ? ["-c", `model_auto_compact_token_limit=${compactAt}`] : []),
    "-c",
    `permissions.agent.filesystem={":minimal"="read", ${JSON.stringify(node())}="read", ${JSON.stringify(own)}="write"}`,
    "-c",
    "permissions.agent.network={enabled=true}",
    "-c",
    'default_permissions="agent"',
    // The agent's folder is its project root: Codex reads no instructions from the
    // folders above it, which the profile keeps out of reach anyway.
    "-c",
    "project_root_markers=[]",
    // Only the app starts agents, so every one of them is in the live panel.
    "-c",
    "features.multi_agent=false",
    "-c",
    "features.multi_agent_v2=false",
  ];
}

// The app's own Codex home and home folder, shared by its Codex agents and
// signed in once through Codex's own sign-in.
export function agentHomes(appDirectory) {
  const homes = { codexHome: join(appDirectory, "agent-homes", "codex"), home: join(appDirectory, "agent-homes", "home") };
  for (const dir of Object.values(homes)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return homes;
}

// The app's skills go where each CLI reads a folder's skills.
export function placeSkills(folder, root, names) {
  for (const name of names)
    for (const place of [".claude/skills", ".agents/skills"])
      cpSync(join(root, "skills", name), join(folder, place, name), { recursive: true, dereference: true });
}
