# Slice 02: Steerable Codex researcher

**Type**: AFK
**Status**: Done

## Blocked by

- Slice 01: Steerable Claude researcher

## What to build

A Codex adapter behind the same supervisor interface runs the Codex app server over JSON-RPC: it starts a thread with folder, sandbox, approval policy, model and effort, starts turns, steers a running turn, and interrupts it.
The coordinator supervises Codex and Claude researchers identically.
Because the app server is experimental, the adapter checks protocol compatibility at startup and fails with a clear error if it changed.
See **Provider adapters**.

## Acceptance criteria

- [x] A Codex researcher appears in the live panel exactly as a Claude researcher does
- [x] Steering and interrupt behave the same for both providers from the coordinator's point of view
- [x] An incompatible app server version is refused at startup with a message naming the problem
- [x] Adapter tests run against recorded Codex streams, including steering and interrupt

## User stories addressed

Reference by number from the parent PRD:

- User story 32
