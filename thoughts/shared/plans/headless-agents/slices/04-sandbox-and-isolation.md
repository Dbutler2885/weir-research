# Slice 04: Sandbox and isolation

**Type**: AFK
**Status**: Done

## Blocked by

- Slice 02: Steerable Codex researcher

## What to build

Every agent runs confined to its own folder with network access, using the setups tested on 2026-09-25 and recorded in the PRD's **Sandbox and isolation**, **Setup** and **Further Notes**.
Claude Code runs with project settings only, strict MCP configuration, its sandboxed Bash limited to the folder with all web domains allowed, and permission rules confining its file tools.
Codex runs with a permission profile, an app-owned Codex home and an app-owned home folder.
The app's skills are placed in each agent's folder, and each agent's host stops and reports any agent CLI started beneath it.

## Acceptance criteria

- [x] A worker can run any command in its folder and reach the web, for both providers
- [x] A worker cannot read or write the human's files, the project's live state, originals, other agents' folders or sign-in files, for both providers
- [x] Neither provider loads the human's instructions, hooks, skills or MCP servers; both load the folder's instructions and skills
- [x] Starting `claude` or `codex` from a worker fails, and a started agent CLI is stopped and reported in the live panel
- [x] Claude Code agents use the human's existing sign-in; Codex agents use the app-owned Codex home

## User stories addressed

Reference by number from the parent PRD:

- User story 26
- User story 48
- User story 49
- User story 50
- User story 54
- User story 55
