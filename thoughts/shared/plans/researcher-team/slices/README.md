# Implementation Slices

Parent PRD: [Researcher team](../prd.md)

## Overview

| # | Slice | Type | Status | Blocked by |
|---|-------|------|--------|------------|
| 01 | [Python session](01-python-session.md) | AFK | In progress | None |
| 02 | [Saving sources](02-saving-sources.md) | AFK | To do | 01 |
| 03 | [Publishing findings](03-publishing-findings.md) | AFK | To do | 02 |
| 04 | [The team and the done phrase](04-team-and-done-phrase.md) | AFK | To do | 03 |
| 05 | [Readers and the cache](05-readers-and-cache.md) | AFK | To do | 01 |
| 06 | [Passages and Jev](06-passages-and-jev.md) | AFK | To do | 05 |
| 07 | [Helpers and job tickets](07-helpers-and-job-tickets.md) | AFK | To do | 04, 05 |
| 08 | [Instructions](08-instructions.md) | AFK | To do | 07 |
| 09 | [Interface](09-interface.md) | HITL | To do | 04, 06 |
| 10 | [Existing projects and the evaluation](10-existing-projects-and-evaluation.md) | HITL | To do | 08, 09 |

## Slice details

- **01 - Python session**: Each researcher gets a confined Python session whose variables last for the life of its seat
- **02 - Saving sources**: The app saves a URL or PDF as a library document, once per source, and researchers lose WebFetch
- **03 - Publishing findings**: Findings are published one at a time, quotes checked at the cited page, and stale graph drafts are refused
- **04 - The team and the done phrase**: A batch opens with a goal and a team of seats that organize on the board and finish with the done phrase
- **05 - Readers and the cache**: Single-prompt readers on a cheap model, batched over labelled passages, cached on disk
- **06 - Passages and Jev**: The passage builder and the Jev sweep with its figures
- **07 - Helpers and job tickets**: Helpers on errands with their own sessions, jobs on disk with tickets, notices and restart recovery
- **08 - Instructions**: The researcher's, helper's and coordinator's instructions and skills rewritten for the team
- **09 - Interface**: Findings as one list per batch, the live panel's seats and jobs, and the new settings
- **10 - Existing projects and the evaluation**: Old batches kept as history, and reruns of past batches with their figures recorded
