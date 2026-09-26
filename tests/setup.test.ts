// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkSetup as check } from "../server/setup.mjs";
import { setupPage as page } from "../server/setup-page.mjs";
import { findBrowser as browserFor } from "../server/research-browser.mjs";

// The modules are JavaScript; the tests pass them plain stand-ins.
const checkSetup = (options: object): any => check(options as any);
const setupPage = (options: object): string => page(options as any);
const findBrowser = (find: any, exists: (file: string) => boolean, defaultId: () => string): any => browserFor(find, exists as any, defaultId);

// What the CLIs answer, by the command run.
function machine({ claude = "signed-in", codex = "signed-out", codexVersion = "0.155.1", installed = ["claude", "codex", "bwrap", "socat", "pkexec"] } = {}) {
  const run = (command: string, args: string[]) => {
    if (args[0] === "--version") return { ok: true, stdout: command.includes("claude") ? "2.1.282 (Claude Code)" : `codex-cli ${codexVersion}` };
    if (args.join(" ") === "auth status --json") return { ok: true, stdout: JSON.stringify({ loggedIn: claude === "signed-in", email: "you@example.com" }) };
    if (args.join(" ") === "login status") return { ok: codex === "signed-in", stdout: "" };
    return { ok: false, stdout: "" };
  };
  return { run, findExecutable: (name: string) => (installed.includes(name) ? `/bin/${name}` : null), browser: () => ({ path: "/b", name: "Brave", isDefault: true, unsupportedDefault: null }) };
}

describe("checking what the app needs", () => {
  it("is ready with one account connected through its own status command", () => {
    const setup = checkSetup({ ...machine(), platform: "darwin" });
    expect(setup.agents.map((a: any) => [a.account, a.installed, a.signedIn])).toEqual([["Claude", true, true], ["ChatGPT", true, false]]);
    expect(setup.agents[0].email).toBe("you@example.com");
    expect(setup.ready).toBe(true);
    expect(setup.dependencies).toEqual([{ id: "browser", label: "Research browser", required: false, ok: true, name: "Brave", isDefault: true, unsupportedDefault: null }]);
  });
  it("is not ready with nothing connected, or only a Codex older than the app supports", () => {
    expect(checkSetup({ ...machine({ claude: "signed-out" }), platform: "darwin" }).ready).toBe(false);
    const old = checkSetup({ ...machine({ claude: "signed-out", codex: "signed-in", codexVersion: "0.120.0" }), platform: "darwin" });
    expect(old.agents[1].outdated).toBe("0.155.1");
    expect(old.ready).toBe(false);
  });
  it("on Linux, needs the sandbox tools before Claude Code can work, and offers to install them", () => {
    const missing = checkSetup({ ...machine({ installed: ["claude", "codex", "pkexec"] }), platform: "linux", installer: () => "sudo apt install" });
    expect(missing.dependencies[1]).toEqual({ id: "sandbox", label: "Sandbox tools", required: true, ok: false, packages: ["bubblewrap", "socat"], command: "sudo apt install bubblewrap socat", canInstall: true });
    expect(missing.ready).toBe(false);
    // ChatGPT through Codex does not need them.
    expect(checkSetup({ ...machine({ codex: "signed-in", installed: ["claude", "codex"] }), platform: "linux", installer: () => "sudo apt install" }).ready).toBe(true);
    expect(checkSetup({ ...machine(), platform: "linux", installer: () => "sudo apt install" }).dependencies[1].ok).toBe(true);
  });
});

describe("choosing the research browser", () => {
  const installed = (...names: string[]) => (file: string) => names.some((n) => file.includes(`/${n}.app/`));
  it("uses the human's default browser when researchers can drive it", () => {
    if (process.platform !== "darwin") return;
    expect(findBrowser(() => null, installed("Google Chrome", "Brave Browser"), () => "com.brave.browser")).toMatchObject({ name: "Brave", isDefault: true });
  });
  it("uses another installed Chromium browser when the default is Safari, and says so", () => {
    if (process.platform !== "darwin") return;
    expect(findBrowser(() => null, installed("Google Chrome"), () => "com.apple.safari")).toMatchObject({ name: "Google Chrome", isDefault: false, unsupportedDefault: "Safari" });
    expect(findBrowser(() => null, installed(), () => "com.apple.safari")).toEqual({ path: null, name: null, isDefault: false, unsupportedDefault: "Safari" });
  });
});

describe("the setup page", () => {
  const agents = (claude: object = {}) => [
    { id: "claude", label: "Claude Code", account: "Claude", installed: true, version: "2.1.282", signedIn: true, email: "you@example.com", ...claude },
    { id: "codex", label: "Codex", account: "ChatGPT", installed: false },
  ];
  const browser = { id: "browser", label: "Research browser", ok: true, name: "Brave", isDefault: true };
  it("leads on with Continue once an account is connected, and never starts research itself", () => {
    const page = setupPage({ setup: { agents: agents(), dependencies: [browser], ready: true } });
    expect(page).toContain('<a class="button primary" href="/welcome">Continue</a>');
    expect(page).not.toContain("What would you like to research?");
    expect(page).toContain("Uses Brave, your default browser");
    expect(page).toContain('data-install="codex">Install Codex</button>');
    expect(setupPage({ setup: { agents: agents(), dependencies: [browser], ready: true }, next: { label: "Back to your project", href: "/" } })).toContain('href="/">Back to your project</a>');
  });
  it("holds Continue until an account is connected, and follows a sign-in with a way to cancel it", () => {
    const page = setupPage({ setup: { agents: agents({ signedIn: false }), dependencies: [browser], ready: false }, signingIn: { agent: "claude", url: "https://example.com/sign-in" } });
    expect(page).toContain("Connect an account to continue.");
    expect(page).toContain('aria-disabled="true">Continue</span>');
    expect(page).toContain("A Claude sign-in page opened in your browser.");
    expect(page).toContain('href="https://example.com/sign-in"');
    expect(page).toContain("data-cancel-sign-in>Cancel</button>");
  });
});
