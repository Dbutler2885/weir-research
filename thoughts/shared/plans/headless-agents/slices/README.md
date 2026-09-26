# Implementation Slices

Parent PRD: [Headless agents](../prd.md)

## Overview

| # | Slice | Type | Status | Blocked by |
|---|-------|------|--------|------------|
| 01 | [Steerable Claude researcher](01-steerable-claude-researcher.md) | AFK | Done | None |
| 02 | [Steerable Codex researcher](02-steerable-codex-researcher.md) | AFK | Done | 01 |
| 03 | [Graph builders and walkthrough writers on the supervisor](03-builders-and-writers-on-supervisor.md) | AFK | Done | 01 |
| 04 | [Sandbox and isolation](04-sandbox-and-isolation.md) | AFK | Done | 02 |
| 05 | [Headless coordinator](05-headless-coordinator.md) | AFK | Done | 04 |
| 06 | [Starting the app](06-starting-the-app.md) | AFK | Done | 05 |
| 07 | [Progress without self-reporting](07-progress-without-self-reporting.md) | AFK | Done | 03 |
| 08 | [Dispatch rules](08-dispatch-rules.md) | AFK | Done | 05 |
| 09 | [Setup screen](09-setup-screen.md) | HITL | Done | 04 |
| 10 | [Sample project](10-sample-project.md) | AFK | Done | 09 |
| 11 | [Research browser](11-research-browser.md) | AFK | Done | 04 |
| 12 | [Quota](12-quota.md) | AFK | Done | 03 |
| 13 | [Detached workers](13-detached-workers.md) | AFK | Done | 12 |
| 14 | [Queue controls](14-queue-controls.md) | AFK | Done | 05 + coordinator context queue |
| 15 | [Context size](15-context-size.md) | HITL | Awaiting human check | 05 |
| 16 | [Migration and cleanup](16-migration-and-cleanup.md) | AFK | Done | 05, 03 |

## Slice details

- **01 - Steerable Claude researcher**: Supervisor with Claude researchers that can be steered and stopped mid-run
- **02 - Steerable Codex researcher**: Codex researchers through the app server, supervised the same way
- **03 - Graph builders and walkthrough writers on the supervisor**: Builders and walkthrough writers on the supervisor, with mid-run feedback
- **04 - Sandbox and isolation**: Every agent confined to its folder with web access and no personal setup
- **05 - Headless coordinator**: The app starts and drives a fresh sandboxed coordinator
- **06 - Starting the app**: One command, or an agent in the project folder, opens the app
- **07 - Progress without self-reporting**: Progress read from streams; checkpoints only at discoveries
- **08 - Dispatch rules**: Per-project dispatch rules file, coordinator command and settings menus
- **09 - Setup screen**: First-run CLI detection, sign-in and dependency checks
- **10 - Sample project**: A fictional sample project with results, openable from setup
- **11 - Research browser**: App-managed Chrome profile shared by workers, one window each
- **12 - Quota**: Quota pauses with reset time, automatic resume, retries untouched
- **13 - Detached workers**: Host processes, heartbeat, keep-running choice and reconnect
- **14 - Queue controls**: Reorder and hold batches; worker default as a setting
- **15 - Context size**: Compaction threshold, context notices, compact now and start fresh
- **16 - Migration and cleanup**: Convert existing projects and remove the old paths
