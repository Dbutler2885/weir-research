// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { execFile, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PythonSession, pythonEnvironment } from "../server/python-session/session.mjs";
import { SessionDesk } from "../server/python-session/desk.mjs";
import { until } from "./fixtures/until";

// One environment serves every run of these tests, so it is downloaded once.
const home = resolve("node_modules/.cache/weir-python-session");
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((clean) => clean());
});

// A seat's folder and a fictional library with one two-page document.
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "weir-session-")));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, "seat");
  const library = join(root, "library");
  mkdirSync(folder);
  mkdirSync(join(library, "documents"), { recursive: true });
  writeFileSync(join(library, "documents", "documents.csv"), "id,name,collection,file,text,pages\ndoc-1,Harbor ledger.pdf,c1,documents/doc-1.pdf,documents/doc-1.txt,2\n");
  writeFileSync(join(library, "documents", "doc-1.txt"), "[Page 1]\nExample Mill opened in 1882.\n\n[Page 2]\nThe ledger names Ada Example.\n");
  writeFileSync(join(library, "sources.csv"), "id,title\ndoc-1,Harbor ledger\n");
  const session = (options = {}) => {
    const s = new PythonSession({ folder, library, home, ...options });
    cleanups.push(() => s.stop());
    return s;
  };
  return { root, folder, library, session };
}

const onMac = process.platform === "darwin";

describe.skipIf(!onMac)("a researcher's Python session", () => {
  beforeAll(() => pythonEnvironment(home), 300_000);

  it("keeps variables between runs, when its process is replaced, and in a new session", async () => {
    const { session } = fixture();
    const first = session();
    await first.run("found = {'mill': 1882}");
    expect((await first.run("print(found['mill'] + 1)")).output).toBe("1883\n");
    first.process!.kill("SIGKILL");
    expect((await first.run("print(found)")).output).toBe("{'mill': 1882}\n");
    first.stop();
    // As after the app restarts: another session on the same seat.
    const second = session();
    expect(await second.start()).toMatchObject({ interrupted: null, problem: null });
    expect((await second.run("print(found['mill'])")).output).toBe("1882\n");
  });

  it("returns only what the code prints, cut off past the limit with a note", async () => {
    const { session } = fixture();
    const s = session({ outputLimit: 100 });
    await s.run("text = 'x' * 50000");
    expect((await s.run("print(len(text))")).output).toBe("50000\n");
    // A value on its own is not shown: only what is printed enters the researcher's context.
    expect((await s.run("text")).output).toBe("");
    const long = await s.run("print(text)");
    expect(long.output.startsWith("x".repeat(100))).toBe(true);
    const id = long.output.match(/\[Output cut short: 49901 more characters were printed\. The whole output is kept: weir\.output\('([^']+)'\) returns it/)![1];
    expect((await s.run(`print(len(weir.output(${JSON.stringify(id)})))`)).output).toBe("50001\n");
  });

  it("names a value it cannot keep, once", async () => {
    const { session } = fixture();
    const s = session();
    const run = await s.run("kept = 1\nrows = (n for n in range(3))");
    expect(run.output).toMatch(/cannot be saved: rows \(generator\)/);
    expect((await s.run("kept += 1")).output).toBe("");
    s.stop();
    const again = session();
    expect((await again.run("print((kept, 'rows' in dir()))")).output).toBe("(2, False)\n");
  });

  it("reports errors as tracebacks of the run's own code", async () => {
    const { session } = fixture();
    const result = await session().run("def f():\n    return 1 / 0\nf()");
    expect(result.failed).toBe(true);
    expect(result.output).toMatch(/File "<run>", line 2, in f/);
    expect(result.output).toMatch(/ZeroDivisionError/);
    expect(result.output).not.toMatch(/kernel\.py/);
  });

  it("reports a run cut short by a restart, without running it again", async () => {
    const { session } = fixture();
    const first = session();
    await first.run("count = 1");
    const slow = first.run("count = 2\nimport time\ntime.sleep(30)");
    await until(() => existsSync(join(first.state, "running.json")));
    // The app ends without hearing how the run went.
    slow.catch(() => {});
    first.waiting.clear();
    process.kill(first.process!.pid!, "SIGKILL");
    await until(() => !first.process);
    const second = session();
    expect((await second.start()).interrupted).toBeTruthy();
    expect((await second.run("print(count)")).output).toBe("1\n");
    // Reported once.
    second.stop();
    expect((await session().start()).interrupted).toBeNull();
  });

  it("never lets a kernel left by a crashed app save over its replacement", async () => {
    const { root, folder, library, session } = fixture();
    // A stand-in app that starts a slow run and then crashes.
    const app = join(root, "app.mjs");
    writeFileSync(
      app,
      `import { PythonSession } from ${JSON.stringify(resolve("server/python-session/session.mjs"))};
const s = new PythonSession({ folder: ${JSON.stringify(folder)}, library: ${JSON.stringify(library)}, home: ${JSON.stringify(home)} });
await s.run("count = 1");
s.run("import time\\ntime.sleep(3)\\ncount = 2");
setTimeout(() => console.log("running"), 300);
`,
    );
    const crashed = spawn(process.execPath, [app], { stdio: ["ignore", "pipe", "inherit"] });
    cleanups.push(() => crashed.kill("SIGKILL"));
    await new Promise<void>((done) => crashed.stdout!.on("data", (d) => String(d).includes("running") && done()));
    crashed.kill("SIGKILL");
    const replacement = session();
    expect((await replacement.start()).interrupted).toBeTruthy();
    await replacement.run("count = 3");
    replacement.stop();
    // Past the moment the old run would have finished and saved.
    await new Promise((done) => setTimeout(done, 3500));
    expect((await session().run("print(count)")).output).toBe("3\n");
  });

  it("reads the library's documents as pages", async () => {
    const { session } = fixture();
    const s = session();
    expect((await s.run("print([d['name'] for d in weir.library.documents()])")).output).toBe("['Harbor ledger.pdf']\n");
    expect((await s.run("print(weir.library.read('doc-1')[1])")).output).toBe("{'page': 2, 'text': 'The ledger names Ada Example.'}\n");
    expect((await s.run("print([(m['document'], m['page']) for m in weir.library.search('mill')])")).output).toBe("[('doc-1', 1)]\n");
  });

  it("is confined to the library and its folder, without the network", async () => {
    const { root, library, folder, session } = fixture();
    writeFileSync(join(root, "private.txt"), "not for the session");
    const server = createServer((socket) => socket.end("hello"));
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    cleanups.push(() => server.close());
    const port = (server.address() as any).port;
    const s = session();
    const attempt = async (code: string) => (await s.run(`try:\n    ${code}\n    print('allowed')\nexcept Exception as e:\n    print('refused')`)).output.trim();
    expect(await attempt(`open(${JSON.stringify(join(library, "sources.csv"))}).read()`)).toBe("allowed");
    expect(await attempt(`open(${JSON.stringify(join(folder, "notes.txt"))}, 'w').write('kept')`)).toBe("allowed");
    expect(await attempt(`open(${JSON.stringify(join(root, "private.txt"))}).read()`)).toBe("refused");
    expect(await attempt(`open(${JSON.stringify(join(library, "new.txt"))}, 'w')`)).toBe("refused");
    expect(await attempt(`__import__('os').listdir(${JSON.stringify(process.env.HOME)})`)).toBe("refused");
    expect(await attempt(`__import__('socket').create_connection(('127.0.0.1', ${port}), timeout=2)`)).toBe("refused");
    expect(await attempt(`__import__('subprocess').run(['/bin/ls'])`)).toBe("refused");
  });
});

describe.skipIf(!onMac)("the session desk", () => {
  beforeAll(() => pythonEnvironment(home), 300_000);

  // The researcher's command tool, run as the agent's shell would run it.
  const tool = (folder: string, code: string, lease: string) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
      const child = execFile(process.execPath, [join(folder, "tools", "python.mjs")], { env: { ...process.env, WEIR_LEASE: lease } }, (error, stdout, stderr) =>
        done({ code: error ? (error as any).code ?? 1 : 0, stdout, stderr }),
      );
      child.stdin!.end(code);
    });

  // A seat whose researcher works in its own folder within it.
  function desk(wait = 60_000) {
    const { folder: seat, library } = fixture();
    const messages: string[] = [];
    let lease = "lease-1";
    // What the app would do for the session's code: a stand-in for saving a source.
    const asked: any[] = [];
    const calls = {
      save: async (given: any, context: any) => {
        asked.push({ ...given, seat: context.key });
        if (given.url.endsWith("/missing")) throw new Error(`${given.url} could not be downloaded: the site answered 404 Not Found.`);
        return { id: "doc-9", title: "Fictional gazette", url: given.url, pages: 1, characters: 80, existing: false };
      },
    };
    const d = new SessionDesk({ home, library, wait, poll: 100, calls });
    cleanups.push(() => d.closeAll());
    const open = (name: string) => {
      const folder = join(seat, name);
      mkdirSync(folder, { recursive: true });
      d.open("seat-1", { folder, seat, authorize: (given: string) => given === lease, deliver: (text: string) => messages.push(text) });
      return folder;
    };
    const folder = open(lease);
    return { folder, messages, open, asked, revoke: (next = "lease-2") => (lease = next) };
  }

  it("runs the researcher's code through its tool", async () => {
    const { folder } = desk();
    expect(await tool(folder, "seen = weir.library.text('doc-1')\nprint(seen.count('Example'))", "lease-1")).toMatchObject({ code: 0, stdout: "2\n" });
    expect(await tool(folder, "print(len(seen))", "lease-1")).toMatchObject({ code: 0, stdout: "59\n" });
    expect(await tool(folder, "1/0", "lease-1")).toMatchObject({ code: 1, stdout: expect.stringMatching(/ZeroDivisionError/) });
  });

  it("lets running code save a source through the app, and hear why when it cannot", async () => {
    const { folder, asked } = desk();
    const saved = await tool(folder, "receipt = weir.save('https://example.org/gazette')\nprint(receipt['id'], receipt['pages'])", "lease-1");
    expect(saved).toMatchObject({ code: 0, stdout: "doc-9 1\n" });
    expect(asked).toEqual([{ url: "https://example.org/gazette", fresh: false, seat: "seat-1" }]);
    await tool(folder, "weir.save('https://example.org/gazette', fresh=True)", "lease-1");
    expect(asked[1]).toMatchObject({ fresh: true });
    const refused = await tool(folder, "try:\n    weir.save('https://example.org/missing')\nexcept weir.AppError as error:\n    print(error)", "lease-1");
    expect(refused.stdout).toBe("https://example.org/missing could not be downloaded: the site answered 404 Not Found.\n");
  });

  it("does nothing for code whose researcher has lost the seat while it ran", async () => {
    const { folder, asked, revoke } = desk();
    const running = tool(folder, "import time\ntime.sleep(1.5)\ntry:\n    weir.save('https://example.org/gazette')\nexcept weir.AppError as error:\n    refusal = str(error)", "lease-1");
    await new Promise((done) => setTimeout(done, 500));
    revoke("lease-2");
    await running;
    expect(asked).toEqual([]);
    revoke("lease-1");
    expect((await tool(folder, "print(refusal)", "lease-1")).stdout).toMatch(/lease on the seat is no longer current, so the app did not do what its code asked/);
  });

  it("keeps the seat's variables when its researcher moves to another agent's folder", async () => {
    const { folder, open, revoke } = desk();
    await tool(folder, "remembered = 42", "lease-1");
    revoke("lease-2");
    const switched = open("lease-2");
    expect(await tool(switched, "print(remembered)", "lease-2")).toMatchObject({ code: 0, stdout: "42\n" });
  });

  it("refuses code from a lease that is no longer the seat's", async () => {
    const { folder, revoke } = desk();
    revoke();
    const result = await tool(folder, "print('ran')", "lease-1");
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/lease on the seat is no longer current/);
    expect(result.stdout).toBe("");
  });

  it("answers long code with a note and sends its output as a message", async () => {
    const { folder, messages } = desk(500);
    const result = await tool(folder, "import time\ntime.sleep(2)\nprint('swept 40 pages')", "lease-1");
    expect(result).toMatchObject({ code: 0, stdout: expect.stringMatching(/Still running after 1 second\./) });
    await until(() => messages.some((m) => m.includes("swept 40 pages")));
    expect(messages.at(-1)).toMatch(/^Your long Python run has finished\. Its output:/);
  });
});
