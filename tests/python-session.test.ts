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
    expect((await s.run("print(weir.library.read('doc-1')[1])")).output).toBe("{'page': 2, 'text': 'The ledger names Ada Example.', 'revision': 1}\n");
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
  function desk(wait = 60_000, more: Record<string, unknown> = {}) {
    const { folder: seat, library } = fixture();
    const messages: string[] = [];
    let lease = "lease-1";
    let stopped = false;
    // What the app would do for the session's code: a stand-in for saving a source.
    const asked: any[] = [];
    // The agent's folder each save was made from.
    const folders: string[] = [];
    const calls = {
      save: async (given: any, context: any) => {
        folders.push(context.folder);
        asked.push({ ...given, seat: context.key });
        if (given.url.endsWith("/missing")) throw new Error(`${given.url} could not be downloaded: the site answered 404 Not Found.`);
        return { id: "doc-9", title: "Fictional gazette", url: given.url, pages: 1, characters: 80, existing: false };
      },
      publish: async (given: any, context: any) => {
        asked.push({ ...given, seat: context.key });
        if (given.finding.evidence[0].page !== 2) throw new Error("Evidence 1 was not found in doc-1 (Harbor ledger.pdf). The quote is not on page 1; it is on page 2. Cite the page it is on.");
        return { id: "report-1/f1", statement: given.finding.statement, evidence: [{ document: "doc-1", pages: [2, 2], check: "checked" }] };
      },
      findings: async (given: any, context: any) => [{ id: "report-1/f1", by: "Researcher 2", statement: `A finding of ${context.key}'s batch.`, qualification: "supported", explanation: "", evidence: [] }],
      helper: async (given: any, context: any) => {
        asked.push({ ...given, seat: context.key });
        return { id: "h1", status: "queued" };
      },
      jev: async (given: any, context: any) => {

        asked.push({ ...given, seat: context.key });
        if (given.document !== "doc-1") throw new Error(`No saved document has the ID ${JSON.stringify(given.document)}.`);
        return { document: "doc-1", passages: [{ label: "doc-1, page 2 line 1 to page 2 line 1", document: "doc-1", pages: [{ page: 2, text: "The ledger names Ada Example." }], matched: ["q1"], probability: 0.9 }], chunks: 2, flagged: 1, characters: 60, passed: 29, whole: false };
      },
      reader: async (given: any, context: any) => {
        asked.push({ ...given, seat: context.key });
        if (given.passages === undefined) return `Reply to: ${given.prompt}`;
        return given.passages.map((p: any) => ({ label: p.label, relevant: p.label !== "gazette", answer: `About ${p.label}.`, quotes: [], cached: false }));
      },
      post: async (given: any, context: any) => {
        if (asked.some((a) => a.text === given.text)) throw new Error("You already posted exactly this, so it was not posted again.");
        asked.push({ ...given, seat: context.key });
        return { posted: true, id: "post-1" };
      },
    };
    const d = new SessionDesk({ home, library, wait, poll: 100, calls });
    cleanups.push(() => d.closeAll());
    const open = (name: string) => {
      const folder = join(seat, name);
      mkdirSync(folder, { recursive: true });
      d.open("seat-1", { folder, seat, authorize: (given: string) => given === lease, deliver: (text: string) => messages.push(text), live: () => !stopped, ...more });
      return folder;
    };
    const folder = open(lease);
    return { folder, messages, open, asked, folders, revoke: (next = "lease-2") => (lease = next), stop: () => (stopped = true), running: () => d.running("seat-1") };
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

  it("lets running code publish a finding, and hear why one is refused", async () => {
    const { folder, asked } = desk();
    const code = (page: number) =>
      `try:\n    receipt = weir.publish("Ada Example is named in the ledger.", "supported", "The ledger names her.", [{"document": "doc-1", "page": ${page}, "quote": "The ledger names Ada Example.", "interpretation": "She is named."}], replaces="report-0/f1")\n    print(receipt["id"], receipt["evidence"][0]["check"])\nexcept weir.AppError as error:\n    print(error)`;
    expect((await tool(folder, code(2), "lease-1")).stdout).toBe("report-1/f1 checked\n");
    expect(asked[0]).toEqual({
      seat: "seat-1",
      finding: { statement: "Ada Example is named in the ledger.", qualification: "supported", explanation: "The ledger names her.", evidence: [{ document: "doc-1", page: 2, quote: "The ledger names Ada Example.", interpretation: "She is named." }], replaces: "report-0/f1" },
    });
    expect((await tool(folder, code(1), "lease-1")).stdout).toBe("Evidence 1 was not found in doc-1 (Harbor ledger.pdf). The quote is not on page 1; it is on page 2. Cite the page it is on.\n");
    // The batch's findings, to read before publishing and to name one to replace.
    expect((await tool(folder, "for f in weir.findings():\n    print(f['id'], f['by'], f['statement'])", "lease-1")).stdout).toBe("report-1/f1 Researcher 2 A finding of seat-1's batch.\n");
  });

  it("lets running code ask readers, with one prompt or a question and passages, and get the answers into variables", async () => {
    const { folder, asked } = desk();
    expect(await tool(folder, "print(weir.reader('Is this fictional?'))", "lease-1")).toMatchObject({ code: 0, stdout: "Reply to: Is this fictional?\n" });
    const code = [
      "pages = weir.library.read('doc-1')",
      "answers = weir.reader('Who is named?', [{'label': 'ledger', 'document': 'doc-1', 'pages': pages}, {'label': 'gazette', 'text': 'Fine weather.'}])",
      "print([a['label'] for a in answers if a['relevant']])",
      "more = weir.reader('Who is named?', {'a': 'One.', 'b': 'Two.'}) + weir.reader('Who is named?', ['First.', 'Second.'])",
      "print([a['label'] for a in more])",
    ].join("\n");
    expect(await tool(folder, code, "lease-1")).toMatchObject({ code: 0, stdout: "['ledger']\n['a', 'b', '1', '2']\n" });
    expect(asked[1]).toMatchObject({ question: "Who is named?", seat: "seat-1", passages: [{ label: "ledger", document: "doc-1", pages: [{ page: 1 }, { page: 2, text: "The ledger names Ada Example." }] }, { label: "gazette", text: "Fine weather." }] });
    expect(asked[3].passages).toEqual([{ label: "1", text: "First." }, { label: "2", text: "Second." }]);
  });

  it("lets running code sweep a document with Jev and hand the passages to readers", async () => {
    const { folder, asked } = desk();
    const code = [
      "sweep = weir.jev('doc-1', ['Does this text name a person?'], threshold=0.5)",
      "answers = weir.reader('Who is named?', sweep['passages'])",
      "print(sweep['flagged'], [a['label'] for a in answers])",
      "try:",
      "    weir.jev('doc-9', ['Anything?'])",
      "except weir.AppError as error:",
      "    print(error)",
    ].join("\n");
    expect(await tool(folder, code, "lease-1")).toMatchObject({ code: 0, stdout: "1 ['doc-1, page 2 line 1 to page 2 line 1']\nNo saved document has the ID \"doc-9\".\n" });
    expect(asked[0]).toEqual({ document: "doc-1", questions: ["Does this text name a person?"], threshold: 0.5, seat: "seat-1" });
    expect(asked[1].passages[0]).toMatchObject({ document: "doc-1", pages: [{ page: 2, text: "The ledger names Ada Example." }], matched: ["q1"] });
    expect(asked[2]).toMatchObject({ document: "doc-9", threshold: 0.3 });
  });

  it("lets running code send a helper, and read its answer from the handle once the app has put it in the session", async () => {
    const { folder, asked } = desk();
    const seat = join(folder, "..");
    const code = "h = weir.helper('Search the fictional gazette for Ada Example.')\nprint(h.id)";
    expect((await tool(folder, code, "lease-1")).stdout).toBe("h1\n");
    expect(asked[0]).toEqual({ errand: "Search the fictional gazette for Ada Example.", seat: "seat-1" });
    // What the app writes of the helper, beside the session's variables.
    const shown = join(seat, "session", "helpers");
    mkdirSync(shown, { recursive: true });
    writeFileSync(join(shown, "h1.json"), JSON.stringify({ id: "h1", errand: "Search the fictional gazette for Ada Example.", status: "running", saved: [] }));
    const waiting = "print(h, h.done)\ntry:\n    h.answer\nexcept weir.AppError as error:\n    print(error)";
    expect((await tool(folder, waiting, "lease-1")).stdout).toBe("<Helper h1: running> False\nHelper h1 is running; you are sent a message when it answers.\n");
    writeFileSync(join(shown, "h1.json"), JSON.stringify({ id: "h1", errand: "Search the fictional gazette for Ada Example.", status: "answered", answer: "She sold the mill in 1901.", quotes: [{ document: "doc-1", page: 2, quote: "Ada Example", found: true }], saved: [{ id: "doc-1", title: "Harbor ledger" }] }));
    writeFileSync(join(shown, "h2.json"), JSON.stringify({ id: "h2", errand: "Another.", status: "failed", problem: "its turn ended with an error", saved: [] }));
    const done = "print(h.done, h.answer['answer'], [q['found'] for q in h.answer['quotes']], h.answer['saved'][0]['id'])\nprint(list(weir.helpers()))\ntry:\n    weir.helpers()['h2'].answer\nexcept weir.AppError as error:\n    print(error)";
    expect((await tool(folder, done, "lease-1")).stdout).toBe("True She sold the mill in 1901. [True] doc-1\n['h1', 'h2']\nHelper h2 failed: its turn ended with an error.\n");
  });

  it("lets running code post to the board, hear when the same post was already made, and counts as under way while it runs", async () => {
    const { folder, asked, running } = desk();
    const code = `import time\ntime.sleep(0.6)\ntry:\n    print(weir.post("The 1881 register is missing from the scans."))\nexcept weir.AppError as error:\n    print(error)`;
    expect(running()).toBe(0);
    const first = tool(folder, code, "lease-1");
    await new Promise((done) => setTimeout(done, 300));
    expect(running()).toBe(1);
    expect((await first).stdout).toBe("{'posted': True, 'id': 'post-1'}\n");
    expect(running()).toBe(0);
    expect(asked).toEqual([{ text: "The 1881 register is missing from the scans.", seat: "seat-1" }]);
    // Run again, the same code does not post twice.
    expect((await tool(folder, code, "lease-1")).stdout).toBe("You already posted exactly this, so it was not posted again.\n");
    expect(asked).toHaveLength(1);
  });

  it("lets code started before its researcher was paused or switched carry on, and sends its output to the seat", async () => {
    const { folder, asked, revoke, messages } = desk();
    const running = tool(folder, "import time\ntime.sleep(1.5)\nsaved = weir.save('https://example.org/gazette')\nprint('saved', saved['id'])", "lease-1");
    await new Promise((done) => setTimeout(done, 500));
    // The researcher is paused: its lease is no longer the seat's.
    revoke("lease-2");
    await until(() => messages.length === 1);
    // The run kept its ticket, so the app did what its code asked.
    expect(asked).toEqual([{ url: "https://example.org/gazette", fresh: false, seat: "seat-1" }]);
    expect(messages[0]).toBe("A Python run started before this seat's researcher was paused or switched has finished. Its output:\n\nsaved doc-9\n");
    // New code from the old researcher is refused.
    expect((await tool(folder, "print(1)", "lease-1")).stderr).toMatch(/lease on the seat is no longer current, so its code was not run/);
    void running;
  });
  it("does nothing more for a run whose seat has been stopped", async () => {
    const { folder, asked, stop } = desk();
    const running = tool(folder, "import time\ntime.sleep(1.5)\ntry:\n    weir.save('https://example.org/gazette')\nexcept weir.AppError as error:\n    print(error)", "lease-1");
    await new Promise((done) => setTimeout(done, 500));
    stop();
    expect((await running).stdout).toBe("This run's seat has been stopped, so the app did not do what its code asked.\n");
    expect(asked).toEqual([]);
  });
  it("refuses a helper's session what only a researcher's may ask, in words the helper can act on", async () => {
    const { folder, asked } = desk(60_000, { can: new Set(["save", "reader", "jev"]), refusal: (name: string) => `A helper's session cannot ${name}; put it in your answer.` });
    const code = "for ask in (lambda: weir.post('x'), lambda: weir.publish('s', 'supported', 'e', []), lambda: weir.helper('go')):\n    try:\n        ask()\n    except weir.AppError as error:\n        print(error)\nprint(weir.save('https://example.org/gazette')['id'])";
    expect((await tool(folder, code, "lease-1")).stdout).toBe("A helper's session cannot post; put it in your answer.\nA helper's session cannot publish; put it in your answer.\nA helper's session cannot helper; put it in your answer.\ndoc-9\n");
    expect(asked).toHaveLength(1);
  });
  it("makes a run's calls from the folder of the agent that started it, though the seat has passed to another's", async () => {
    const { folder, open, revoke, folders } = desk();
    const long = tool(folder, "import time\ntime.sleep(1.2)\nweir.save('https://example.org/gazette')", "lease-1");
    await new Promise((done) => setTimeout(done, 400));
    revoke("lease-2");
    const next = open("lease-2");
    await until(() => folders.length === 1);
    expect(folders).toEqual([folder]);
    await tool(next, "weir.save('https://example.org/gazette')", "lease-2");
    expect(folders).toEqual([folder, next]);
    void long;
  });
  it("keeps a seat's session, and the code running in it, when the seat is opened again for its next researcher", async () => {
    const { folder, open, revoke, messages } = desk();
    await tool(folder, "kept = 7", "lease-1");
    const long = tool(folder, "import time\ntime.sleep(1.5)\nkept += 1\nprint('done', kept)", "lease-1");
    await new Promise((done) => setTimeout(done, 400));
    revoke("lease-2");
    const next = open("lease-2");
    // The next researcher's code waits its turn behind the run under way, in the same session.
    expect((await tool(next, "print(kept)", "lease-2")).stdout).toBe("8\n");
    expect(messages).toEqual(["A Python run started before this seat's researcher was paused or switched has finished. Its output:\n\ndone 8\n"]);
    void long;
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
