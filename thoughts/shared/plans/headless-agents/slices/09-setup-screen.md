# Slice 09: Setup screen

**Type**: HITL
**Status**: Done

## Blocked by

- Slice 04: Sandbox and isolation

## What to build

A first-run setup screen detects installed CLIs and versions, shows each one's sign-in status from its own status command, and starts each provider's own sign-in, including the one-time Codex sign-in into the app-owned Codex home.
It checks for Google Chrome and, on Linux, bubblewrap and socat, showing the install command for anything missing.
It asks nothing about models and says these can be changed later in settings.
The human can return to it later.
HITL: the human reviews the screen's design, since it is the first thing a visitor sees.
See **Setup**.

## Acceptance criteria

- [x] A machine with one CLI can complete setup
- [x] Sign-in status is correct for each CLI, and sign-in uses the provider's own flow
- [x] Missing Chrome or Linux packages are named with their install command
- [x] The app never reads, copies or stores credentials
- [x] Setup works on macOS and Linux
- [x] The human has reviewed and approved the screen's design

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 2
- User story 3
- User story 4
- User story 6
- User story 7
- User story 8
