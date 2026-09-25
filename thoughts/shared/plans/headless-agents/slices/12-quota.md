# Slice 12: Quota

**Type**: AFK
**Status**: Not started

## Blocked by

- Slice 03: Graph builders and walkthrough writers on the supervisor

## What to build

A quota module recognizes exhaustion from each provider's reports, such as Codex rate-limit notifications and Claude's rate-limit events, pauses affected agents with the reason and reset time, resumes them when quota returns, and never counts the pause as a failed attempt.
Remaining quota is shown where the provider reports it.
See **Quota**.

## Acceptance criteria

- [ ] Quota exhaustion shows as a pause with reason and reset time, not a failure
- [ ] Paused work resumes on its own when quota returns
- [ ] A graph builder's retries are unchanged by a quota pause
- [ ] Remaining quota appears where reported
- [ ] Recognition is tested against recorded provider output

## User stories addressed

Reference by number from the parent PRD:

- User story 56
- User story 57
- User story 58
- User story 59
- User story 60
