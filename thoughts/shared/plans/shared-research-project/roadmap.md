# Shared research: design workstreams

Recorded 2026-09-18 from the product discussion.
These are directions for further design, not an approved implementation plan.
Application planning belongs here; real research and experimental artifacts remain under the ignored `.research/` directory.

## Scope A: the shared-project experience

1. **One shared research project.** Questions, findings, sources, evidence, and the graph accumulate within the project.
   Assignment history preserves provenance without partitioning access or making the human switch investigation containers.
   This is the first design priority; see [the draft PRD](prd.md).
2. **Fluid human-coordinator interaction.** Freeform questions and referenced annotations share an interaction surface, with immediate sending or batching.
   Responses can be brief explanations, corrections, or further work rather than triggering a complete formal pipeline.
   Agreed: persistent project conversation in the existing annotations panel, opened to a specific coordinator message by an actionable notification.
3. **Navigable updates.** Explain what was learned or changed and take the human to the exact affected material, with context and a return path.
   A generic announcement that new research is ready is insufficient.
4. **Walkthroughs as milestones.** Evidence and graph walkthroughs orient the human when requested or useful to the coordinator.
   They cease to be mandatory stages for every contribution; graph approval ceases to be a universal gate.
   Preserve uncertainty and correction history without making rollback a central product workflow.
   Findings remains the historical researcher-return record, with sent batches as the outermost grouping, then coordinator-written question headings and assignment scopes, in its table of contents.
   A sent queue batch establishes the walkthrough boundary; relevant findings remain displayed within the walkthrough as well as in Findings.
   Generation timing and automatic defaults remain open so the human can prioritize token spending on research.

## Scope B: research execution and knowledge infrastructure

These are separate subsequent design efforts, not prerequisites to implementing all of Scope A.
Scope A still requires sufficient project-wide access to avoid preserving hidden knowledge silos.

5. **Several research assignments per question.** Separate the human's question and feedback batch from worker execution.
   Prefer question-based decomposition, with bounded source-specific tasks where useful.
   Preserve coordinator responsibility for synthesis, scope, and expenditure.
   Add a separate walkthrough authoring agent so presentation work does not occupy the coordinator for its full duration.
6. **Progressive access to accumulated knowledge.** Provide a thin index of findings, qualifications, originating questions, and source IDs.
   Stable IDs are the references; a common `read(id)` operation retrieves detail, with pagination for long material.
   Semantic retrieval and automatic relevance-packet assembly are not required for the initial design.
7. **Researcher board.** Automatically deliver posts made during an agent's lifetime into its context at supported delivery points.
   Older posts are available through paginated retrieval.
   Keep source-backed discoveries, questions, and corrections durable; define recovery and delivery semantics before implementation.
8. **Adapt the existing separate graph builder.** A separate builder, invocation skill, durable CSV outputs, and graph tour already exist.
   Change their integration to support small coordinator invocations, shared knowledge access, and ongoing updates without requiring the full walkthrough-first pipeline.
   Do not plan to build this capability from scratch.
   Capture research snapshots and graph revisions, permit consultation of older research, and design follow-up escalation to the coordinator and human.
9. **Durable source acquisition and reuse.** Preserve originals, processed representations, evidence passages, access information, and scoped records of prior inspection and searches.
   Continue the acquisition and PDF-processing design separately, grounded in the implementation already present.

## Relationship to previous plans

The [guided research and graph proposals PRD](../guided-research-graph-proposals/prd.md) records the earlier walkthrough-first, human-application-gated design.
Keep it as historical rationale and implementation context.
This work proposes changing those orchestration assumptions while retaining the useful presentation, evidence, and graph-builder capabilities.
Do not treat these drafts as permission to change live research or operating instructions before implementation is agreed.
