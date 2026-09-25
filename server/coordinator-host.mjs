import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { executableOnPath } from './researchers.mjs';
import { fileDescriber } from './live-activity.mjs';
import { placeSkills } from './agents/isolation.mjs';

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
  constructor({store, coordinator, supervisor, directory, root, handle, findExecutable = executableOnPath, provider = null, debounce = 400}) {
    Object.assign(this, {store, coordinator, supervisor, directory, root, handle, findExecutable, debounce});
    this.preferred = provider;
    this.agent = null;
    this.problem = null;
  }
  // The coordinator runs on the saved provider when it is installed, otherwise on
  // whichever agent CLI is.
  provider() {
    const saved = this.preferred || this.store.state.engine;
    return [saved, 'claude', 'codex'].find((p) => ['claude', 'codex'].includes(p) && this.findExecutable(p)) || null;
  }
  start() {
    const provider = this.provider();
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
      prompt,
      describe: fileDescriber(coordinatorFiles),
    });
    this.agent = agent;
    agent.on('action', (text) => this.coordinator.noteText(text));
    agent.on('turn', () => this.flush());
    agent.on('failed', (error) => { this.problem = `The coordinator could not start: ${error.message}`; });
    agent.on('exit', () => {
      if (this.agent !== agent) return;
      this.agent = null;
      this.problem ||= 'The coordinator stopped. Reopen the project to start a fresh one.';
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
  status() {
    return {connected: Boolean(this.agent), listening: Boolean(this.agent) && !this.agent.busy, problem: this.problem};
  }
  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounce);
  }
  // Every change the coordinator has not yet been told about, as one message.
  flush() {
    if (!this.agent || this.agent.finishing) return;
    const delta = this.coordinator.delta(this.secret, this.cursor);
    this.cursor = delta.revision;
    if (delta.unchanged) return;
    const body = delta.changed
      ? JSON.stringify(delta.changed, null, 1)
      : delta.context.text;
    this.agent.send(`The project changed. Act on what needs you, answer the human in the conversation, then end your turn.\n\n${body}`);
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
