# Walkthrough publication

Send commands through `npm run coordinator -- command <file> --session <sessionFile>`.
The example names and IDs below are fictional placeholders.

```json
{
  "action": "publish-walkthrough",
  "investigationId": "investigation-id",
  "walkthrough": {
    "proposalIds": ["preserved-findings-proposal-id"],
    "title": "Locating the workshop",
    "question": "Where was Example Works?",
    "journey": "A short account of the investigation.",
    "answer": "The answer supported by the evidence, with its qualification.",
    "caveats": ["The precise street remains unknown."],
    "steps": [{
      "id": "location",
      "title": "A town, but not a street",
      "body": "Explain the evidence and its implications.\n\nUse paragraph breaks for the reader.",
      "evidenceRefs": ["preserved-findings-proposal-id/passage-id"],
      "transition": "This gives us a town. Next, we can examine the firm's identity."
    }],
    "closing": "Bring the answer together and lead into the proposed graph."
  }
}
```

`proposalIds` selects immutable published findings within this investigation.
Each `evidenceRefs` entry combines its proposal ID, a slash, and the exact evidence ID.
The service supplies immutable walkthrough and job IDs and queues graph work with a complete graph snapshot and the selected original research.
Omit `engine` to honor the saved preference; `manual` uses native delegation, while `codex` and `claude` use managed file-writing workers.
A paused investigation requires the existing browser resume confirmation before publication.

For a revision, supply `basedOnWalkthroughId` with the current walkthrough ID and include `walkthrough.correction` for consequential changes.
Old revisions and reading positions remain available.
An update does not jump the reader into a different explanation.
All graph changes remain subject to explicit browser application.
