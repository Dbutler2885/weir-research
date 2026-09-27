// The introduction to annotating, shown beside the Annotate switch the first time
// the human opens any project. Its demo plays the feature once over: pointing at a
// finding, asking about it, and the coordinator answering about that finding.
export function annotationIntro(): string {
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘I" : "Ctrl+I";
  return `<div class="intro-demo" aria-hidden="true">
  <div class="demo-finding"><span class="demo-kicker">Supported</span><p>Edith's parents were Thomas and Ann Marrow.</p></div>
  <svg class="demo-cursor" viewBox="0 0 16 20"><path d="M1 1v15l4-3.6 2.6 5.8 2.4-1.1-2.6-5.7H13z"/></svg>
  <div class="demo-note"><span class="demo-ref">Batch 1 · finding</span><p>Is this the same Thomas as in the 1881 household list?</p></div>
  <div class="demo-reply"><span>Coordinator</span><p>I'll check the 1881 list for Thomas Marrow and tell you.</p></div>
</div>
<h2 id="annotate-intro-title">Point at anything and ask about it</h2>
<p>Turn on Annotate (${shortcut}), then click a finding, a source or someone on the graph, or select a few words. Your note reaches the coordinator with exactly what you pointed at, so it knows which record you mean.</p>
<div class="intro-actions"><button type="button" class="primary" data-intro-try>Try it</button><button type="button" data-intro-done>Got it</button></div>`;
}
