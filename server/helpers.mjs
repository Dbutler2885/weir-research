import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { executableOnPath } from './researchers.mjs';
import { LiveActivity, fileDescriber } from './live-activity.mjs';
import { AgentSupervisor } from './agents/supervisor.mjs';

const MAX_TASK = 20_000;

// Helpers do small tasks the coordinator hands off, so they do not use the most
// expensive model. A helper works in its own folder, answers once, and closes;
// its answer goes back to the coordinator as a message.
export class Helpers {
  constructor(store, directory, {launch, findExecutable = executableOnPath, live = new LiveActivity(), supervisor = new AgentSupervisor({launch, live}), dispatch = /** @type {any} */ (null), answer = (_text) => {}} = {}) {
    Object.assign(this, {store, directory, findExecutable, live, supervisor, dispatch, answer});
    this.active = new Map();
  }
  ask({task, engine = null, model = null, effort = null}) {
    if (typeof task !== 'string' || !task.trim() || task.length > MAX_TASK) throw new Error('Describe the helper\'s task in up to 20,000 characters.');
    const choice = this.dispatch?.choose('helper', engine ? {agent: engine, model, effort} : null) ?? (engine ? {agent: engine} : null);
    const executable = choice && this.findExecutable(choice.agent);
    if (!executable) throw new Error('No agent CLI is installed for the helper.');
    const id = randomUUID();
    const folder = join(this.directory, 'helpers', id);
    mkdirSync(folder, {recursive: true});
    writeFileSync(join(folder, 'AGENTS.md'), `You are a helper for a research coordinator, doing one small task.
Do the task, then reply with your answer as your final message; the coordinator reads that reply.
Work only in this folder. Do not start other agents.
`);
    const summary = task.trim().split('\n')[0].slice(0, 120);
    const agent = this.supervisor.start({
      key: `helper:${id}`,
      provider: choice.agent,
      executable,
      folder,
      web: true,
      model: choice.model,
      effort: choice.effort,
      prompt: task.trim(),
      live: {role: 'helper', name: choice.agent === 'codex' ? 'Codex helper' : 'Claude helper', task: summary},
      meta: {project: this.directory, role: 'helper'},
      describe: fileDescriber({'AGENTS.md': {read: 'Reading its instructions'}}),
    });
    this.active.set(id, agent);
    agent.on('turn', ({outcome, text}) => {
      if (outcome === 'interrupted') return;
      agent.finish();
      this.answer(`Your helper finished "${summary}":\n\n${text || '(It gave no answer.)'}`);
    });
    agent.on('failed', (error) => this.answer(`Your helper for "${summary}" could not run: ${error.message}`));
    agent.on('exit', () => this.active.delete(id));
    return {helperId: id};
  }
  stop() {
    for (const agent of this.active.values()) agent.stop();
  }
}
