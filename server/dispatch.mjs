import { randomUUID } from 'node:crypto';
import { changeDispatch, choose, defaultDispatch, firstAgent } from '../src/domain/dispatch.ts';

// The project's dispatch rules: which agent, model and effort does each job.
export class DispatchRules {
  constructor(store, catalog) {
    this.store = store;
    this.catalog = catalog;
  }
  // A project without rules gets one CLI, with its own defaults, for every role.
  ensure() {
    if (this.store.state.dispatch) return this.store.state.dispatch;
    const agent = firstAgent(this.catalog, this.store.state.engine);
    if (!agent) return null;
    this.store.update((next) => { next.dispatch = defaultDispatch(agent); });
    return this.store.state.dispatch;
  }
  // The agent, model and effort for a role, honouring what was named for this assignment.
  choose(role, named) {
    const doc = this.ensure();
    if (named?.agent) return choose(doc || defaultDispatch(named.agent), role, named);
    return doc ? choose(doc, role) : null;
  }
  change(command, by) {
    const doc = this.ensure();
    if (!doc) throw new Error('No agent CLI is installed. Install Claude Code or Codex first.');
    const next = changeDispatch(doc, command, this.catalog, by, randomUUID, new Date().toISOString());
    this.store.update((state) => { state.dispatch = next; });
    return next;
  }
}
