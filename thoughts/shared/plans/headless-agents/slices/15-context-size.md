# Slice 15: Context size

**Type**: HITL
**Status**: Not started

## Blocked by

- Slice 05: Headless coordinator

## What to build

The coordinator's compaction threshold is a Research setting, defaulting to 200,000 tokens or the model's limit if lower, applied through Claude Code's auto-compact window or Codex's auto-compact token limit.
The app tracks context size from the stream, notifies the human before the threshold, and offers keep going, compact now and start fresh; start fresh is available whenever the coordinator is idle and picks up running workers and queued work.
HITL: a human confirms that each CLI's threshold setting triggers compaction at the chosen size, which the PRD leaves to implementation and which spends real quota.
See **Context size**.

## Acceptance criteria

- [ ] The threshold setting takes effect for both providers, confirmed in a real session
- [ ] Notices appear as the context grows
- [ ] Compact now works for both providers
- [ ] Start fresh is available when idle and loses no running or queued work

## User stories addressed

Reference by number from the parent PRD:

- User story 61
- User story 62
- User story 63
- User story 64
- User story 65
- User story 66
