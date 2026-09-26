import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { executableOnPath } from './researchers.mjs';
import { fileDescriber } from './live-activity.mjs';
import { placeSkills } from './agents/isolation.mjs';
import { flowCommand } from './review-flow.mjs';
import { applyEdits } from '../src/domain/walkthrough-edits.ts';

const SKILLS = ['coordinate-research', 'research-contract', 'prepare-research-graph'];
const coordinatorFiles = {
  'AGENTS.md': {read: 'Reading its instructions'},
  'SKILL.md': {read: 'Reading one of its skills'},
  'research.mjs': {read: null},
};

// The app's coordinator: a fresh agent started whenever the app opens a project,
// in its own sandboxed folder. It sends commands through a mailbox in that folder,
// and the app sends it every change to the project as a message.
export class CoordinatorHost {
  constructor({store, coordinator, supervisor, directory, root, handle, findExecutable = executableOnPath, provider = null, dispatch = null, debounce = 400}) {
    Object.assign(this, {store, coordinator, supervisor, directory, root, handle, findExecutable, dispatch, debounce});
    this.preferred = provider;
    this.agent = null;
    this.problem = null;
  }
  // The coordinator runs on the agent the dispatch rules choose for it when that is
  // installed, otherwise on whichever agent CLI is.
  choice() {
    const chosen = this.preferred ? {agent: this.preferred} : this.dispatch?.choose('coordinator');
    if (chosen && this.findExecutable(chosen.agent)) return chosen;
    const agent = [this.store.state.engine, 'claude', 'codex'].find((p) => ['claude', 'codex'].includes(p) && this.findExecutable(p));
    return agent ? {agent} : null;
  }
  start() {
    // Every opening starts a fresh coordinator; one left from an earlier opening stops.
    for (const record of this.supervisor.hosted((r) => r.meta?.project === this.directory && ['coordinator', 'helper'].includes(r.meta?.role)))
      this.supervisor.dismiss(record);
    const choice = this.choice();
    const provider = choice?.agent;
    if (!provider) {
      this.problem = 'No agent CLI is installed. Install Claude Code or Codex to start the coordinator.';
      this.coordinator.problem = this.problem;
      return null;
    }
    this.problem = null;
    const prompt = this.prepare();
    const agent = this.supervisor.start({
      key: 'coordinator',
      provider,
      executable: this.findExecutable(provider),
      folder: this.folder,
      web: true,
      compactAt: this.threshold(),
      meta: {project: this.directory, role: 'coordinator'},
      model: choice.model,
      effort: choice.effort,
      prompt,
      describe: fileDescriber(coordinatorFiles),
    });
    this.agent = agent;
    this.since = Date.now();
    agent.on('action', (text) => this.coordinator.noteText(text));
    agent.on('turn', () => {
      this.since = null;
      this.syncWalkthroughs(true);
      this.flush();
    });
    agent.on('paused', ({reason}) => this.coordinator.noteText(reason));
    // How full its context is, from its stream.
    this.context = {tokens: 0, window: null, compactions: 0};
    agent.on('context', ({tokens, window}) => {
      if (tokens != null) this.context.tokens = tokens;
      if (window) this.context.window = window;
    });
    agent.on('compacted', ({after}) => {
      this.context.compactions++;
      // Its size after compacting, where reported; otherwise the next reply says.
      this.context.tokens = after ?? 0;
      this.context.compacting = false;
      this.coordinator.noteText('Compacted its conversation');
    });
    agent.on('resumed', () => this.coordinator.noteText('The usage limit reset; carrying on.'));
    agent.on('failed', (error) => { this.problem = `The coordinator could not start: ${error.message}`; });
    agent.on('exit', ({reason} = {}) => {
      if (this.agent !== agent) return;
      this.agent = null;
      this.since = null;
      const at = new Date().toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'});
      this.problem ||= `The coordinator stopped at ${at}${reason === 'lost' ? ' when it lost contact with the app' : ''}.`;
      this.coordinator.problem = this.problem;
      this.close();
    });
    this.unsubscribe = this.store.subscribe(() => this.schedule());
    return agent;
  }
  // The coordinator's folder, its session and its mailbox, and the first message
  // it starts from. The context evaluation prepares one without starting an agent.
  prepare() {
    const folder = join(this.directory, 'coordinator', new Date().toISOString().replace(/[:.]/g, '-'));
    mkdirSync(join(folder, 'tools'), {recursive: true});
    mkdirSync(join(folder, 'requests'), {recursive: true});
    mkdirSync(join(folder, 'responses'), {recursive: true});
    const template = join(this.root, 'server', 'agents', 'coordinator');
    copyFileSync(join(template, 'AGENTS.md'), join(folder, 'AGENTS.md'));
    copyFileSync(join(template, 'research.mjs'), join(folder, 'tools', 'research.mjs'));
    placeSkills(folder, this.root, SKILLS);
    // The app's coordinator replaces any earlier session; only one coordinates a project.
    this.coordinator.session = null;
    this.secret = randomUUID();
    this.coordinator.attach('Coordinator', this.secret);
    this.coordinator.host = this;
    const snapshot = this.coordinator.snapshot(this.secret);
    this.cursor = snapshot.revision;
    this.folder = folder;
    this.written = {};
    this.syncWalkthroughs(false);
    this.watcher = watch(join(folder, 'requests'), () => this.mailbox());
    // The regular sweep still reads the mailbox if watching the folder fails.
    this.watcher.on('error', () => {});
    this.sweep = setInterval(() => this.mailbox(), 250);
    this.sweep.unref();
    return `You are starting as this project's coordinator. Here is where the project stands.\n\n${snapshot.context.text}`;
  }
  close() {
    this.unsubscribe?.();
    this.watcher?.close();
    clearInterval(this.sweep);
    clearTimeout(this.timer);
    if (this.coordinator.host === this) {
      this.coordinator.host = null;
      this.coordinator.session = null;
    }
  }
  stop() {
    const agent = this.agent;
    this.agent = null;
    agent?.stop();
    this.close();
  }
  // The context size at which the coordinator compacts: the human's setting, 200,000
  // tokens by default, or the model's own window when that is smaller.
  threshold() {
    const set = this.store.state.researchSettings?.compactAt ?? 200_000;
    return this.context?.window ? Math.min(set, this.context.window) : set;
  }
  status() {
    const context = this.context && {tokens: this.context.tokens, threshold: this.threshold(), compactions: this.context.compactions, compacting: Boolean(this.context.compacting)};
    const since = this.agent?.busy && this.since ? new Date(this.since).toISOString() : null;
    return {connected: Boolean(this.agent), listening: Boolean(this.agent) && !this.agent.busy, problem: this.problem, context, since};
  }
  // Compacts the coordinator's conversation now.
  compact() {
    if (!this.agent) throw new Error('The coordinator is not running.');
    this.context.compacting = true;
    this.since ??= Date.now();
    this.agent.compact();
    this.coordinator.noteText('Compacting its conversation');
  }
  // A fresh coordinator from the project's saved state, when this one is idle.
  // Workers and queued work carry on; the new coordinator starts from them.
  startFresh() {
    if (this.agent?.busy) throw new Error('The coordinator is working. Start fresh once it is listening.');
    this.stop();
    this.problem = null;
    this.coordinator.problem = null;
    return Boolean(this.start());
  }
  // Something for the coordinator that is not in the project's state, such as a helper's answer.
  tell(text) {
    if (this.agent && !this.agent.finishing) this.send(text);
  }
  // A message starts a turn when it is idle, or joins the one it is in.
  send(text) {
    if (!this.agent.busy) this.since = Date.now();
    this.agent.send(text);
  }
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounce);
  }
  // Each batch's walkthrough as a file in the coordinator's folder, with its suggested
  // edits in place, so it corrects one by editing the file. At the end of its turn the
  // app reads what it changed as suggested edits; a file it is still editing mid-turn
  // is left alone, and the others follow the project.
  walkthroughFiles() {
    return this.store.state.investigations.filter(i => i.number && i.reviewFlow?.walkthroughs.length).map(i => {
      const latest = i.reviewFlow.walkthroughs.at(-1);
      const edits = i.reviewFlow.edits?.basedOnWalkthroughId === latest.id ? i.reviewFlow.edits.edits : [];
      return {i, file: join(this.folder, 'walkthroughs', `batch-${i.number}.json`), text: `${JSON.stringify(applyEdits(latest, edits), null, 2)}\n`};
    });
  }
  syncWalkthroughs(consume) {
    if (!this.folder) return;
    const read = (file) => {
      try {
        return readFileSync(file, 'utf8');
      } catch {
        return null;
      }
    };
    const touched = new Set();
    for (const {i, file} of this.walkthroughFiles()) {
      const disk = read(file);
      if (disk === null || this.written[file] === undefined || disk === this.written[file]) continue;
      touched.add(file);
      if (!consume) continue;
      try {
        const before = this.store.state.revision;
        flowCommand(this.store, {action: 'suggest-walkthrough-edits', investigationId: i.id, walkthrough: JSON.parse(disk)});
        // The coordinator knows what its own edit changed.
        if (this.cursor === before) this.cursor = this.store.state.revision;
      } catch (error) {
        this.tell(`Your change to walkthroughs/batch-${i.number}.json was not used: ${error.message} The file is back as it was.`);
      }
    }
    mkdirSync(join(this.folder, 'walkthroughs'), {recursive: true});
    for (const {file, text} of this.walkthroughFiles()) {
      if (touched.has(file) && !consume) continue;
      if (read(file) !== text) writeFileSync(file, text);
      this.written[file] = text;
    }
  }
  // Every change the coordinator has not yet been told about, as one message.
  flush() {
    if (!this.agent || this.agent.finishing) return;
    this.syncWalkthroughs(false);
    const delta = this.coordinator.delta(this.secret, this.cursor);
    this.cursor = delta.revision;
    if (delta.unchanged) return;
    const body = delta.changed
      ? JSON.stringify(delta.changed, null, 1)
      : delta.context.text;
    this.send(`The project changed. Act on what needs you, answer the human in the conversation, then end your turn.\n\n${body}`);
  }
  // Each command the coordinator's tool leaves in its mailbox gets an answer beside it.
  async mailbox() {
    if (!this.folder || this.reading) return;
    this.reading = true;
    try {
      const requests = join(this.folder, 'requests');
      for (const name of readdirSync(requests).filter((n) => n.endsWith('.json'))) {
        const file = join(requests, name);
        let data;
        try {
          data = JSON.parse(readFileSync(file, 'utf8'));
        } catch {
          continue;
        }
        rmSync(file, {force: true});
        const before = this.store.state.revision;
        let answer;
        try {
          answer = {result: await this.command(data)};
        } catch (error) {
          answer = {error: error.message};
        }
        // The coordinator knows what its own command changed.
        if (this.cursor === before) this.cursor = this.store.state.revision;
        const response = join(this.folder, 'responses', name);
        writeFileSync(`${response}.tmp`, JSON.stringify(answer));
        renameSync(`${response}.tmp`, response);
      }
    } finally {
      this.reading = false;
    }
  }
  async command(data) {
    if (!data || typeof data !== 'object' || typeof data.action !== 'string') throw new Error('A command needs an action.');
    if (['attach', 'detach', 'wait', 'ack'].includes(data.action)) throw new Error('The app manages your session; send research commands only.');
    // The app runs every worker; the coordinator assigns them rather than working natively.
    if (['claim', 'claim-graph', 'submit-graph-files'].includes(data.action))
      throw new Error('The app runs every worker. Assign one with assign, assign-graph or assign-walkthrough.');
    const result = await this.handle({...data, session: this.secret});
    if (data.action === 'snapshot') return {revision: result.revision, context: result.context.text};
    return result;
  }
}
