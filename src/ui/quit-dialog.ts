import type { ResearchState } from "../domain/research";
import { html } from "./finding-review";

// Workers that can keep running after the project closes: researchers, graph builders
// and walkthrough writers. The coordinator and helpers always stop.
export function keepableWorkers(state: ResearchState): number {
  return (state.live || []).filter((w) => w.role === "researcher" || w.role === "builder" || w.role === "writer").length;
}

// What closing the project asks: whether running workers should carry on without it.
export function quitDialog(state: ResearchState): string {
  const working = keepableWorkers(state);
  if (!working)
    return `<h2>Close this project?</h2><p>The coordinator stops, and all your work is saved. You can open it again from your projects.</p><div class="quit-actions"><button type="button" class="primary" data-quit="stop">Close project</button><button type="button" data-quit="cancel">Cancel</button></div>`;
  const them = working === 1 ? "it" : "them";
  return `<h2>${html(working === 1 ? "A worker is still working" : `${working} workers are still working`)}</h2><p>Keep ${them} running after the project closes? ${working === 1 ? "It carries" : "They carry"} on alone, including waiting out a usage limit, and the app takes ${them} back when the project opens again. The coordinator stops either way.</p><div class="quit-actions"><button type="button" class="primary" data-quit="keep">Keep ${them} running</button><button type="button" data-quit="stop">Stop ${them}</button><button type="button" data-quit="cancel">Cancel</button></div>`;
}

// What the page says once the project has closed, when the welcome page could not start.
export function closedNotice(kept: number): string {
  return `<main class="app-closed"><h1>The project is closed</h1><p>${kept ? `${kept === 1 ? "One worker keeps" : `${kept} workers keep`} running and ${kept === 1 ? "is" : "are"} taken back when the project opens again. ` : ""}Run <code>npm start</code> in the app's folder to open it again.</p></main>`;
}
