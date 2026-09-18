# App integration

Implement the approved PRD as a complete browser and coordinator workflow.
Keep existing investigations, researcher submissions, and applied graphs intact.

- [ ] Add immutable walkthroughs, durable builder jobs, graph reviews, and group application with revision and provenance checks.
- [ ] Connect coordinator commands and managed CSV builders, including saved work, updates, queries, pause approval, and recovery.
- [ ] Build the guided reading and graphical review UI with stable reading position, annotations, source inspection, and useful activity destinations.
- [ ] Update coordinator and builder instructions to use the integrated flow.
- [ ] Verify the complete workflow with fictional integration fixtures and browser testing, then expose the existing Lubec material through the new flow without duplicating its applied graph.

The coordinator remains the current coding agent.
Publishing a research walkthrough queues graph preparation immediately; human reading does not gate that preparation.
The coordinator inspects the builder's frozen CSV submission and authors its graphical walkthrough before publishing it.
Only the browser apply action changes the accepted graph.
Existing legacy findings and graph proposals remain inspectable.
