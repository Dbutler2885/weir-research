import type { ResearchState } from "../domain/research";
import { html } from "./finding-review";

// Workers that can keep running after the app closes: researchers, graph builders
// and walkthrough writers. The coordinator and helpers always stop.
export function keepableWorkers(state: ResearchState): number {
  return (state.live || []).filter((w) => w.role === "researcher" || w.role === "builder" || w.role === "writer").length;
}

// What quitting asks: whether running workers should carry on without the app.
export function quitDialog(state: ResearchState): string {
  const working = keepableWorkers(state);
  if (!working)
    return `<h2>Quit the app?</h2><p>The coordinator stops, and all your work is saved. Run <code>npm start</code> to open it again.</p><div class="quit-actions"><button type="button" class="primary" data-quit="stop">Quit</button><button type="button" data-quit="cancel">Cancel</button></div>`;
  const them = working === 1 ? "it" : "them";
  return `<h2>${html(working === 1 ? "A worker is still working" : `${working} workers are still working`)}</h2><p>Keep ${them} running after the app closes? ${working === 1 ? "It carries" : "They carry"} on alone, including waiting out a usage limit, and the app takes ${them} back when it opens again. The coordinator stops either way.</p><div class="quit-actions"><button type="button" class="primary" data-quit="keep">Keep ${them} running</button><button type="button" data-quit="stop">Stop ${them}</button><button type="button" data-quit="cancel">Cancel</button></div>`;
}

// What the page says once the app has closed.
export function closedNotice(kept: number): string {
  return `<main class="app-closed"><h1>The app is closed</h1><p>${kept ? `${kept === 1 ? "One worker keeps" : `${kept} workers keep`} running and ${kept === 1 ? "is" : "are"} taken back when the app opens again. ` : ""}Run <code>npm start</code> in the project folder to open it again.</p></main>`;
}
