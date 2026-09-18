export function validateTour(tour, graph, graphSha256) {
  const errors = [];
  if (tour.graphSha256 !== graphSha256) errors.push("Tour refers to another graph revision");
  const nodes = new Set(graph.nodes.map(n => n.id));
  const claims = new Set(graph.claims.map(c => c.id));
  const issues = new Set(graph.issues.map(i => i.id));
  if (!tour.introduction?.trim()) errors.push("Tour introduction required");
  if (!Array.isArray(tour.steps) || !tour.steps.length) errors.push("Tour steps required");
  const stepIds = new Set();
  for (const step of tour.steps || []) {
    if (!step.id || stepIds.has(step.id)) errors.push("Tour step IDs must be unique");
    stepIds.add(step.id);
    for (const [key, valid] of [["focusNodeIds", nodes], ["focusClaimIds", claims], ["issueIds", issues]]) {
      if (!Array.isArray(step[key])) errors.push(`${step.id}: ${key} must be an array`);
      else for (const id of step[key]) if (!valid.has(id)) errors.push(`${step.id}: unknown ${key} target ${id}`);
    }
    if (!(step.focusNodeIds?.length || step.focusClaimIds?.length)) errors.push(`${step.id}: graph focus required`);
    if (![step.title, step.explanation, step.transition].every(v => typeof v === "string" && v.trim())) errors.push(`${step.id}: title, explanation and transition required`);
  }
  return { valid: errors.length === 0, errors };
}
