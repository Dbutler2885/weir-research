# Headless agents

Status: drafted 2026-09-24 from the design discussion and two rounds of decisions; reviewed 2026-09-25, with the sandbox, sign-in and compaction decisions tested against both CLIs.
This PRD builds on the coordinator context PRD, which supplies what a fresh coordinator reads when it starts.

## Problem Statement

The research workspace only works on the developer's own machine, in the developer's own setup.
The coordinator is whatever Claude Code session the human happens to have open in the repository, so the app cannot start it, see what it is doing, or restart it.
It depends on global skills, a personal browser setup, personal hooks and shell configuration, and tools installed separately.
Someone cloning the project from GitHub, such as a person deciding whether to hire its author, cannot sign in and try it.

The agents the app does launch are hard to work with:

- Researchers and graph builders are started with their input closed, so nothing can reach them once they start.
  A redirection from the human waits until the next run, and runs can last a long time.
- The coordinator can bypass the app by claiming work natively and launching its own subagents, which the app cannot see.
  On 2026-09-22 the live panel showed "1 researcher working" and "Coordinator listening" while five subagents were working.
- Workers spend effort reporting their own status in files the app polls, when the app could read what they are doing from their output stream.
- Researchers are limited to a narrow allowlist of commands, and Codex researchers have no network in their sandbox, which causes confusing refusals.
- When a provider's quota runs out mid-run, work fails as if it had broken, and graph builders spend their retries on it.
- Workers inherit the developer's personal MCP servers, hooks and instructions.
- The human cannot choose which agent, model and effort does which job without editing code.
- A long coordinator session grows until it degrades, and there is no clean way to start a new one without losing its place.

## Solution

The app launches and supervises every agent, including the coordinator, as a headless process whose output it reads and whose input stays open.

On first run the human sees a setup screen that finds the installed agent CLIs (Claude Code and Codex), shows whether each is signed in, and starts the provider's own sign-in when needed.
The app never reads or stores credentials.
Setup asks nothing about models: every role uses the signed-in CLI with its own default model and effort, the screen says these can be changed later in settings, and the human can open a sample project to try the app at once.

When the app opens a project it starts a fresh coordinator, which reads the startup context from the coordinator context PRD and picks up where the work stands.
Everything the human sends goes to the coordinator, which assigns work to researchers, graph builders, walkthrough writers and helpers according to dispatch rules the human can see and change by talking to it.
Workers keep running while the human keeps working, and the coordinator can steer or stop any of them mid-run when the human changes direction.

The live panel shows every running agent and what it is doing, read from its output stream, with no self-reported status.
Workers run in their own folder with a sandboxed shell that can run any command there, with network access, and share one app-managed research browser that the human signs in to once.
Quota exhaustion pauses the affected work with a clear explanation and resumes it when the quota returns.
Workers can survive an app restart when the human chooses, and never outlive the app by accident.

The coordinator uses its CLI's built-in compaction at a threshold the human sets, 200,000 tokens by default.
The app tells the human as the context grows, and the human decides whether to keep going, compact now, or start fresh.

## User Stories

### First run and setup

1. As a visitor who cloned the project, I want the app to tell me which agent CLIs it needs and whether they are installed, so that I know what to do before anything fails.
2. As a visitor, I want to sign in to Claude Code or Codex from the setup screen using the provider's own sign-in, so that I never paste credentials into this app.
3. As a visitor, I want the app to show whether each CLI is signed in, so that I can see at a glance that setup worked.
4. As a visitor, I want to be able to use the app with only one of the two CLIs, so that I do not need two subscriptions to try it.
5. As a visitor, I want to open a sample project right after setup, so that I can see what the app does before starting my own research.
6. As a visitor, I want the app to work without installing global skills, browser helpers or shell configuration, and to tell me exactly how to install anything else it needs, so that setup never fails without explanation.
7. As a researcher on macOS or Linux, I want the same setup to work on my platform, so that the app is not tied to one operating system.
8. As a researcher, I want to return to the setup screen later, so that I can sign in to another provider or change defaults.
9. As a researcher with existing projects, I want them to keep working after this change, converted in place, so that I lose nothing.
10. As a visitor, I want to start the app with one command in the project folder, so that I do not need to learn the project's scripts.
11. As a visitor who uses Codex or Claude Code, I want to open it in the project folder and ask it to open the app, so that I can start without typing commands myself.

### Choosing agents

12. As a researcher, I want one default agent, model and effort used for every role unless I say otherwise, so that I do not have to configure anything to start.
13. As a researcher, I want to choose the agent, model and effort for each role from menus, so that I can use a strong model where it matters and a cheaper one elsewhere.
14. As a researcher, I want the menus to list only the models my installed CLIs actually offer, so that I cannot pick one that will fail.
15. As a researcher, I want to tell the coordinator in the conversation how I want work dispatched, so that I can state preferences in plain words instead of editing settings.
16. As a researcher, I want the coordinator to turn my preference into a rule I can see, so that I know exactly what it will do.
17. As a researcher, I want the settings view to show every dispatch rule, including ones added later, so that nothing about dispatch is hidden.
18. As a researcher, I want to be told that anything beyond the menus can be asked of the coordinator, so that I know how to set more specific rules.
19. As a coordinator, I want dispatch rules I can read and update, so that I assign each job to the agent the human wants.
20. As a coordinator, I want a helper role for small tasks, so that simple work does not use the most expensive model.

### The coordinator

21. As a researcher, I want the app to start the coordinator when I open a project, so that I never have to open a terminal.
22. As a researcher, I want a fresh coordinator every time I open the app, so that each session starts clean from the project's saved state.
23. As a researcher, I want to see what the coordinator is doing right now, read from its actions, so that I know whether it is working or listening.
24. As a researcher, I want everything I send to go through the coordinator, so that one agent keeps the whole picture.
25. As a researcher, I want to annotate freely while agents are working, so that I never wait for them to finish.
26. As a researcher, I want no agent, including the coordinator, able to launch agents the app cannot see, so that the live panel is always complete.
27. As a researcher, I want the coordinator to have a sandboxed shell like the researchers, so that it can inspect files and run the app's commands without special cases.

### Workers that can be steered

28. As a researcher, I want to redirect a batch while its researcher is working, so that a long run does not continue in the wrong direction.
29. As a researcher, I want my redirection to reach the worker at its next step, so that it takes effect in minutes, not after the run.
30. As a researcher, I want the coordinator to be able to stop a worker outright, so that clearly wrong work ends immediately.
31. As a researcher, I want to add feedback to a graph draft being built and have it reach the builder, so that the next draft already reflects it.
32. As a coordinator, I want to steer and interrupt Claude and Codex workers the same way, so that dispatch rules do not change how I supervise.
33. As a coordinator, I want to know when a worker finishes a turn and is waiting, so that I can give it the next instruction or let it close.
34. As a researcher, I want workers to stop when their assignment is done, so that finished agents do not sit idle using resources.

### Seeing the work

35. As a researcher, I want the live panel to list every running agent with its role and batch, so that I know who is working on what.
36. As a researcher, I want each agent's current action described in a plain sentence, so that I can follow progress without reading logs.
37. As a researcher, I want graph builders' activity shown in the live panel, so that I know a draft is coming.
38. As a researcher, I want to see a draft graph only when it is ready with its tour, so that I review a finished draft rather than one changing under me.
39. As a researcher, I want the walkthrough writer to appear in the live panel like any other worker, so that its work is not invisible.
40. As a worker, I want to spend my effort on research rather than writing status files, so that runs are faster and cheaper.
41. As a researcher, I want saved checkpoints to hold real discoveries, not running commentary, so that recovery material is worth reading.

### The queue and concurrency

42. As a researcher, I want to see the queue of batches in order with their status, so that I know what runs next.
43. As a researcher, I want to move a batch up or down the queue, so that the most important work goes first.
44. As a researcher, I want to hold a batch in the queue, so that it waits without being closed.
45. As a researcher, I want the coordinator to run at most four workers at once by default, so that my quota is not drained by accident.
46. As a researcher, I want to change that default in Research settings, so that I can run more or fewer workers.
47. As a researcher, I want to be able to ask for more workers than the default for a particular job, so that "one agent per person" is possible when I want it.

### Tools, sandbox and browser

48. As a researcher, I want workers to run any command they need inside their own folder, so that they do not refuse reasonable work.
49. As a researcher, I want workers to have network access, so that web research works for every provider.
50. As a researcher, I want workers unable to read or change anything on my computer outside their own folder, including my project's live state and originals, so that an agent cannot reach my files or damage my research.
51. As a researcher, I want workers to use one research browser the app manages, so that I sign in to archives once.
52. As a researcher, I want each worker to use its own window or tab in that browser, so that workers do not interfere with one another.
53. As a researcher, I want that browser kept separate from my personal browser, so that agents never touch my own accounts.
54. As a researcher, I want workers isolated from my personal agent setup, such as my MCP servers, hooks and global instructions, so that the app behaves the same for everyone.
55. As a worker, I want the app's instruction skills available in my folder, so that I can load the procedure I need.

### Quota

56. As a researcher, I want the app to recognize when a provider's quota runs out, so that it is not reported as a failure.
57. As a researcher, I want affected work paused with the reason and the time the quota returns, so that I know what happened and when it will continue.
58. As a researcher, I want paused work to resume when the quota returns, so that I do not have to restart it by hand.
59. As a researcher, I want quota pauses not to use up a graph builder's retries, so that a quota gap never ends a job.
60. As a researcher, I want to see remaining quota where the provider reports it, so that I can plan large jobs.

### Context size

61. As a researcher, I want to set the coordinator's compaction threshold in Research settings, so that I control when it compacts.
62. As a researcher, I want the default threshold to be 200,000 tokens, or the model's limit if lower, so that it works well without configuration.
63. As a researcher, I want the app to tell me as the coordinator's context grows, so that I am not surprised by a compaction.
64. As a researcher, I want to choose between keeping going, compacting now, and starting fresh, so that I stay in control of the session.
65. As a researcher, I want starting fresh to be one easy action whenever the coordinator is idle, so that a clean session is always available.
66. As a researcher, I want a fresh coordinator to pick up running workers and queued work, so that starting fresh loses nothing.

### Lifetime

67. As a researcher, I want to be asked when I quit whether workers should keep running, so that long research can continue without the app open.
68. As a researcher, I want workers I did not keep running to stop when the app closes or crashes, so that no agent is left orphaned.
69. As a researcher, I want the app to reconnect to workers that kept running when I reopen it, so that I can see and steer them again.
70. As a researcher, I want a worker that kept running to finish with the instructions it started with, so that an app update does not change a run halfway.

### Development

71. As a developer, I want one supervisor for every agent process, so that launching, reading, steering and stopping work the same for every role.
72. As a developer, I want each provider's protocol behind one adapter, so that adding another CLI does not change the rest of the app.
73. As a developer, I want the dispatch rules validated against a schema, so that a bad rule is refused with a clear message.
74. As a developer, I want agent supervision testable with a fake CLI, so that tests do not use real providers or quota.
75. As a developer, I want the research browser covered by an integration test, so that sign-in sharing and per-worker windows keep working.

## Implementation Decisions

**Remove the native route.**
The coordinator no longer claims investigations for itself or launches subagents.
Its tools exclude agent-spawning tools, so every agent is launched by the app and appears in the live panel.
No agent can start another agent through its shell either: the sandbox hides the human's home folder, where the agent CLIs and their sign-in files live, and each agent's host watches the processes beneath it, stops any agent CLI started there, and reports the attempt in the live panel.
The claim-based coordinator checkpoint and publish paths are removed once no project depends on them.

**Agent supervisor.**
One module launches and supervises every agent process: coordinator, researchers, graph builders, walkthrough writers and helpers.
Its interface is small: start an agent with a role, assignment, folder and chosen agent; send it a message; steer it mid-turn; interrupt it; stop it; and subscribe to its actions and turn boundaries.
It reads every action from the agent's output stream and reports them to the live activity model, which already turns tool calls into sentences.
It replaces the separate researcher and graph builder pools, which today close stdin at launch.

**Provider adapters.**
Each CLI sits behind an adapter with the same interface.
The Claude adapter runs Claude Code in print mode with streamed JSON input and output, keeps input open, sends messages as user messages, and interrupts with a control request.
A message sent while a turn is running reaches the agent at its next tool step.
The Codex adapter runs the Codex app server over its JSON-RPC protocol: it starts a thread with the folder, sandbox, approval policy, model and effort, starts turns, steers a running turn, and interrupts it.
Both steering paths were tested in this repository on 2026-09-23.
The Codex app server is marked experimental, so its adapter keeps a compatibility check at startup and a clear error if the protocol changes.

**Detached workers.**
Each agent runs under a small host process that owns its input and output, writes its stream to disk, and accepts messages from the app over a local socket.
The app sends a heartbeat; a host stops its agent when the heartbeat stops, unless the human chose to keep workers running when they quit.
On opening, the app finds running hosts from a registry, reconnects, and replays their saved streams into the live panel.
A worker keeps the instructions and app version it was launched with until its assignment ends.

**The coordinator host.**
The app starts a fresh coordinator whenever it opens a project, using the startup context from the coordinator context PRD.
The coordinator's loop is driven by the app: new conversation messages, finished turns and other events are sent to it as messages, replacing the wait and acknowledge commands.
Every message, from the human or from an event, reaches the coordinator at its next step, even in the middle of a turn.
Starting fresh while the app is running ends the current coordinator when it is idle and starts a new one from the same startup context.

**Dispatch rules.**
Dispatch rules are a JSON document per project with a default agent and, per role, an agent, model and effort, plus optional rules with a condition, a choice and a reason.
The roles are coordinator, researcher, graph builder, walkthrough writer and helper.
The default uses the same agent for every role, with that CLI's own default model and effort: the only signed-in CLI, or the first one signed in when both are.
The coordinator adds or updates entries through a command when the human states a preference.
In settings the human can add, change or remove any entry, with menus listing every agent, model and effort available in the app.
The settings view is rendered from the rules document, so new kinds of rules appear without new interface code.
Model and effort choices come from what each installed CLI reports: Codex lists its models and each model's efforts through `codex debug models`, and Claude Code accepts model aliases such as opus and sonnet.

**Starting the app.**
The app starts with one command in the project folder, which installs anything missing on first run, starts the server and opens the browser.
Opening Codex or Claude Code in the project folder is the other way in: when the human asks it to open the app, it runs the same command itself, outside its own sandbox with the human's approval, so the app can launch its agents.
The app runs as its own process and keeps running when that agent closes.
That agent is not the coordinator.
The app starts its own coordinator, and the repository's instructions no longer describe the coordinator role, which moves into the app's own agent folder with the wait and acknowledge commands removed.
The same agent remains available for development work in the repository.

**Setup.**
A setup module detects installed CLIs and their versions, reports sign-in status through each CLI's own status command, and starts each CLI's own sign-in.
It never reads, copies or stores credentials.
Claude Code agents reuse the human's existing Claude Code sign-in, because Claude Code can skip personal configuration while keeping it.
Codex cannot: with the human's own Codex home it always loads their global instructions and skills.
Codex agents therefore run with an app-owned Codex home and an app-owned home folder, and the setup screen signs in to Codex once through Codex's own sign-in, saved in the app's Codex home.
The setup screen shows the result, a note that agents, models and effort can be changed later in settings, and the sample project.
It asks no questions about models.
Setup also checks for Google Chrome, which the research browser drives, and on Linux for the bubblewrap and socat packages that Claude Code's sandbox needs; anything missing is shown with the command that installs it.
The sample project is fictional, ships with the app, and already holds sources, findings and a draft graph, so a visitor sees the app's results before spending any quota.

**Concurrency and the queue.**
There is no concurrency cap in code.
The coordinator's instructions default to at most four workers at once; the human changes that in Research settings, and can ask for more for a particular job.
The queue is the ordered list of batches from the coordinator context PRD; this PRD adds the controls to move a batch up or down and to hold it.

**Sandbox and isolation.**
Every agent, including the coordinator, gets a sandboxed shell that can run any command inside its own working folder, with network access.
An agent can read and write only its own folder and the app's skills and tools.
The rest of the computer is out of reach, including the human's files, the project's live state, imported originals, other agents' folders and the providers' sign-in files.
Each CLI's own sandbox enforces this, configured to restrict reading as well as writing:

- Codex runs with a permission profile that allows the minimal system files for reading, the agent's folder for writing, and network access.
  Codex's standard workspace-write sandbox is not enough, because it can read the whole disk.
- Claude Code runs its sandboxed Bash with reading denied under the human's home folder except the agent's folder, writing allowed only in the agent's folder, and all web domains allowed.
  Its own file tools are outside that sandbox, so permission rules allow them only inside the agent's folder and refuse everything else without asking.
Results reach the project only through the app's commands.
Agents run without the human's personal configuration: no personal MCP servers, hooks, skills or global instructions.
Claude Code loads only project settings and the app's MCP configuration; Codex uses the app-owned homes described under Setup.
The app's own skills are placed in each agent's folder where its CLI reads folder-level skills.

**Research browser.**
The app manages one research browser with its own profile, separate from the human's browsers.
The human signs in to archives in it once, and every worker gets its own window or tab.
If shared sessions prove unreliable, per-agent profiles are the fallback.
The browser helper, Chrome DevTools MCP, is an app dependency, not a global install, and drives the installed Google Chrome with the app's own profile.

**Progress without self-reporting.**
Workers no longer write status files; the live panel reads their actions from the stream.
Checkpoints stay for recovery but are written only at real discoveries and before a worker stops.

**Quota.**
A quota module recognizes quota exhaustion from each provider's reports, such as the Codex rate-limit notifications and Claude's rate-limit errors.
It pauses the affected agents with the reason and the reset time, resumes them when the quota returns, and never counts a quota pause as a failed attempt.
Remaining quota is shown where the provider reports it; Claude Code reports rate-limit events in its stream.
While the app is closed, a worker kept running holds its own pause in its host and resumes at the reset time.

**Context size.**
The coordinator uses its CLI's built-in compaction.
For Claude Code the threshold is set through its auto-compact window setting, and compact now is a `/compact` message; for Codex the threshold is its auto-compact token limit, and compact now is the app server's compact request.
Both report compaction in their streams, including the context size before and after.
The threshold is a Research setting, defaulting to 200,000 tokens for a Claude or Codex coordinator, or the model's limit if lower.
The app tracks the coordinator's context size from its stream and notifies the human at set points before the threshold.
The notice offers keep going, compact now, and start fresh; starting fresh is available whenever the coordinator is idle.

**Platforms.**
macOS and Linux are supported.
Windows is a later slice.

**Migration.**
Existing projects convert in place when first opened.
Paused native-route work stays paused and is resumed through the new workers.

## Testing Decisions

Good tests drive a module through its public interface and check what a user or the coordinator would observe: messages delivered, actions reported, agents paused or stopped, rules applied.
They do not check internal state or protocol details beyond what an adapter promises.

Tests are written for:

- **Agent supervisor**, with a fake CLI process that speaks each provider's protocol: launch, actions reported, a message delivered at the next step, interrupt, stop, and turn boundaries.
- **Provider adapters**, against recorded Claude and Codex streams, including steering and interrupt.
- **Detached workers**: a worker stops when the heartbeat stops, keeps running when the human chose that, and is reconnected on reopening; an agent CLI started beneath a worker is stopped and reported.
- **Dispatch rules**: schema validation, role defaults, and the rule chosen for an assignment.
- **Quota**: recognition from recorded provider output, pause and resume, and retries left untouched.
- **Coordinator host**: fresh start on opening, events delivered as messages, and start fresh only when idle.

The research browser gets an integration test in the existing integration suite: one profile shared across workers, one window per worker, and separation from the human's browsers.

Prior art: the live activity tests for stream reading, the researcher and graph builder tests for supervised runs, and the coordinator integration test for CLI and service behavior.

## Out of Scope

- Windows support.
- A packaged desktop app with its own icon.
- The human messaging workers directly; everything goes through the coordinator.
- A live graph that changes while a builder works.
- Built-in research tools beyond the shell and browser, which get their own PRD.
- Cleaning up the repository's older folders and scripts, which gets its own plan.
- What a fresh coordinator reads at startup, covered by the coordinator context PRD.
- Sharing discoveries between workers on a researcher board.

## Further Notes

Firstmate keeps agents alive in tmux windows so a human can talk to them directly.
This design gets the same benefits, long-lived agents that can be reached mid-run, from open input streams and host processes, without tmux and without direct human-to-worker messaging.

Firstmate's dispatch rules, with a condition, a choice and a reason per rule, are the model for this project's rules.
Its quota floors may become a later kind of rule.

The sandbox, isolation, sign-in and compaction decisions above were tested on 2026-09-25 against Claude Code 2.1.282 and Codex 0.155.1:

- Claude Code with only project settings and strict MCP configuration kept the human's sign-in, dropped their global instructions, hooks and MCP servers, and loaded the folder's instructions and skills.
- Codex with hooks, apps, plugins and MCP servers turned off still loaded the human's global instructions and skills; separate Codex and home folders removed both and kept the folder's.
  A separate Codex home starts signed out.
- Codex's workspace-write sandbox could list the human's documents; the permission profile blocked the documents and the Codex sign-in file while allowing the folder and the web.
- Claude Code's sandboxed Bash was blocked from the home folder and reached the web once all domains were allowed; its Read tool read outside the folder until the permission rules above refused it.
- Inside either sandbox, starting `claude` or `codex` failed with "Operation not permitted."
- Sending `/compact` to a Claude Code session in print mode compacted it and reported the result in its stream, from 13,741 tokens to 1,093.
  Codex's app server has a compact request, not yet exercised.

Two details are confirmed during implementation: how Claude Code reports its available models beyond its aliases, and that each CLI's threshold setting triggers compaction at the chosen size.
