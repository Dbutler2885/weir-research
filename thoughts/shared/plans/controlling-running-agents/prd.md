# Controlling running agents

Status: drafted 2026-10-01 from the design discussion recorded in the agreed work list (items 2 to 5).
It builds on the researchers on assignments PRD, which gives each researcher its own assignment and saved session.

## Problem Statement

Once an agent is running, the human has little control over it.

- A graph builder can be paused only from the status line shown while reading the batch's walkthrough in Review, where the human did not find it.
  Researchers, walkthrough writers and the coordinator have no pause the human can reach from where they appear.
- A paused or interrupted graph builder or walkthrough writer starts again from its checkpoint file, losing the conversation it had built up; only researchers keep theirs.
- Changing a role's model in Research settings affects only work started afterwards.
  On 2026-10-01 the human moved the graph-builder role to a newer model while Batch 7's builder kept running on the old one, and could not switch it.
- Switching a running agent is not free: its next turn on a new model re-reads its whole conversation without the cache, and switching to a different program loses the conversation entirely.
  The human has no way to see that cost before choosing.

## Solution

Every running agent can be paused, resumed and switched to another model from where it appears.

Each running agent's row in the live panel, and the batch it works on, offer Pause and Switch model; a paused agent offers Resume.
Pausing stops the agent but keeps its saved session.
Resuming picks up the same conversation.
Graph builders and walkthrough writers get saved sessions, as researchers have, so a pause, a closed app or a crash no longer loses their conversation.

Switching a running agent's model pauses it, changes its model, and resumes it.
With the same program, it keeps its conversation, and its next turn re-reads that conversation without the cache.
With a different program, it cannot take its conversation along, and starts again from its last checkpoint.
The coordinator switches by starting a fresh coordinator on the new model, which reads the project's state.

When the human changes a role's model in Research settings while agents in that role are running, a pop-up lists each of them.
For each, the human chooses to switch it now or leave it on its current model, and sees what switching will cost: the size of the conversation it will re-read without the cache, or, for a different program, that it will start again from its last checkpoint.

## User Stories

1. As a human, I want to pause a running researcher from its row in the live panel, so that I can stop work I no longer want right now.
2. As a human, I want to pause a running graph builder from the live panel, so that I do not have to find it in a walkthrough's status line.
3. As a human, I want to pause a running walkthrough writer, so that every kind of worker can be held.
4. As a human, I want the same controls on the batch an agent works on, so that I can act from wherever I am looking.
5. As a human, I want a paused agent listed with Resume, so that I can find and restart it.
6. As a human, I want a resumed agent to continue its conversation, so that its work is not lost.
7. As a human, I want graph builders to keep their conversation through a closed app or a crash, so that an interrupted draft continues where it stopped.
8. As a human, I want walkthrough writers to keep their conversation the same way, so that a long walkthrough is not started over.
9. As a human, I want an agent whose saved conversation cannot be found to start again from its checkpoint, so that resuming never leaves work stuck.
10. As a human, I want to switch a running agent to another model from its row, so that I can move work to a better or cheaper model mid-run.
11. As a human, I want a switch to the same program to keep the conversation, so that the agent carries on with everything it knows.
12. As a human, I want to be told before switching to a different program that the conversation is lost and the agent restarts from its last checkpoint, so that I choose knowingly.
13. As a human, I want to see how much conversation a switch re-reads without the cache, so that I know what it costs my usage.
14. As a human, I want to switch an agent paused by its usage limit to another program, so that work continues on an account that has usage left.
15. As a human, I want changing a role's model in settings to ask about the agents already running in that role, so that the change reaches them if I want it to.
16. As a human, I want to choose for each running agent whether to switch it now or leave it, so that a nearly finished agent is not disturbed.
17. As a human, I want the pop-up to show each agent's batch and what it is doing, so that I can tell them apart.
18. As a human, I want leaving an agent on its current model to be the safe default, so that nothing changes unless I say so.
19. As a human, I want switching the coordinator to start a fresh coordinator on the new model, so that it rebuilds its context cheaply from the project.
20. As a human, I want changes to the default choice to ask about every running agent that follows the default, so that the pop-up covers all affected agents.
21. As a coordinator, I want to know when the human paused, resumed or switched one of my researchers, so that I do not steer an agent that is no longer running.
22. As a human, I want pausing a researcher to keep its place in the batch's limit free for another, so that a paused researcher does not block the batch.
23. As a developer, I want each running agent's context size recorded, so that the cost of a switch can be shown.

## Implementation Decisions

- Graph builders and walkthrough writers record their saved session when their program reports it, as researchers do, and resume it after a pause, a closed app or a crash; when it cannot be found, they start again from their checkpoint.
- Pause, resume and switch are app actions on a running agent, identified by what it works on: an assignment, a graph job, or a walkthrough writer.
  Pausing stops the agent's process and keeps its saved session; the work is marked paused.
  Resuming starts the agent again with its saved session.
- Switching with the same program resumes the saved session on the new model; switching to a different program discards the session and starts afresh from the checkpoint.
  Both Claude Code and Codex accept a new model when resuming a saved conversation; this is verified against the real programs before building.
- The coordinator is switched by starting a fresh coordinator with the new choice.
- The app records each running agent's latest context size as its program reports it, so the switch cost can be shown in tokens.
- The live panel gives each running agent Pause and Switch model, and each paused one Resume; the batch view offers the same for its agents.
  The existing pause in the walkthrough status line stays.
- Changing a role, or the default, in Research settings opens a pop-up when running agents follow that choice, listing each with its batch, its current activity, and the cost of switching; the human chooses per agent, and leaving it unchanged is the default.
- The coordinator is told in its app news when the human pauses, resumes or switches one of its agents.
- A paused researcher does not count against its batch's limit of researchers.

## Testing Decisions

- Tests check what the human can do and what the agent experiences, not internal structure.
- Saved sessions for graph builders and walkthrough writers are tested end to end with the fake Claude and Codex: interrupt, resume the same session, and fall back to the checkpoint when it is missing.
  Prior art: the tests for resuming interrupted researchers.
- Pause, resume and switch are tested end to end: the process stops and starts, the same program keeps the session with the new model, and a different program starts afresh.
- The switch cost is tested as a pure calculation from the recorded context size and the choice.
- The pop-up and the live panel controls are tested in the workspace interface tests, and checked in a real browser.
- Resuming with a new model is checked once against the real Claude Code and Codex with a cheap prompt, as resuming sessions was.

## Out of Scope

- Pausing or switching helpers, which are short tasks.
- Automatic switching when a usage limit is reached; the human decides.
- Changing which program or model a role uses by default, which Research settings already does.

## Further Notes

- The coordinator rebuilds its context from the project's saved state, so starting it fresh costs little and keeps nothing important from being lost.
- Switching a usage-limited Codex researcher to Claude Code, or the reverse, is the most likely everyday use of a switch.
