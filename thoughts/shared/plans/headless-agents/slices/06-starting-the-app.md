# Slice 06: Starting the app

**Type**: AFK
**Status**: Done

## Blocked by

- Slice 05: Headless coordinator

## What to build

The app starts with one command in the project folder that installs anything missing on first run, starts the server as its own process and opens the browser.
Codex or Claude Code opened in the project folder runs the same command when asked to open the app, outside its sandbox with the human's approval.
The repository's instructions stop describing the coordinator role and cover development and launching only.
See **Starting the app**.

## Acceptance criteria

- [x] One command on a fresh clone installs dependencies, starts the app and opens the browser
- [x] Asking Codex or Claude Code in the project folder to open the app starts it after one approval
- [x] Closing that agent leaves the app running
- [x] The repository's AGENTS.md no longer tells an agent to act as coordinator

## User stories addressed

Reference by number from the parent PRD:

- User story 10
- User story 11
