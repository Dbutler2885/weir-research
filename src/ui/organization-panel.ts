import type { ResearchState } from "../domain/research";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function mountOrganizationPanel(
  getState: () => ResearchState,
  request: (path: string, data: unknown) => Promise<any>,
  refresh: () => Promise<void>,
  notify: (message: string) => void,
) {
  const dialog = document.createElement("dialog");
  dialog.className = "annotation-dialog organization-dialog";
  dialog.setAttribute("data-lavish-ui", "organization");
  dialog.setAttribute("aria-label", "Organize research graph");
  document.body.append(dialog);
  let busy = false;
  let previewId: string | undefined;
  function show() {
    previewId = undefined;
    const state = getState();
    const nodes = [
      ...state.dataset.people.map((p) => ({ ...p, kind: "person" })),
      ...(state.dataset.contextEntities || []),
    ];
    const last = state.organization?.history.at(-1);
    dialog.innerHTML = `<div class="dialog-heading"><span class="eyebrow">Your research workspace</span><button type="button" data-close-organization aria-label="Close organization">×</button></div>
      <h2>${nodes.length ? "Organize the graph" : "Add a starting point"}</h2>
      <p>Starting points identify what to investigate. They do not add researched claims.</p>
      <form id="organization-form">
      ${nodes.length ? `<fieldset class="organization-nodes"><legend>Keep these nodes</legend><div class="organization-selection"><button type="button" data-select-nodes="all">Select all</button><button type="button" data-select-nodes="none">Clear selection</button></div>${nodes.map((n) => `<label><input type="checkbox" name="keep" value="${escape(n.id)}" checked><span>${escape(n.name)}<small>${escape(n.kind)}</small></span></label>`).join("")}</fieldset>` : ""}
      <label for="starting-name">${nodes.length ? "Add a starting point (optional)" : "Name"}</label>
      <input id="starting-name" name="name" maxlength="200" placeholder="For example, Lubec, Maine" ${nodes.length ? "" : "required"}>
      <label for="starting-kind">Type</label><select id="starting-kind" name="kind"><option value="place">Place</option><option value="organization">Organization</option><option value="person">Person</option><option value="family">Family</option><option value="event">Event</option><option value="vessel">Vessel</option></select>
      <p class="muted">Sources, annotations, investigation history, and coordinator notes stay saved. Active work will pause so its references can be checked.</p>
      <button class="primary" type="submit">Preview changes</button></form>
      <div id="organization-preview" hidden></div>
      ${last && last.appliedRevision === state.datasetRevision ? `<div class="organization-undo"><p>Last organization: ${escape(last.reason)}</p><button type="button" data-undo-organization="${escape(last.id)}">Undo last organization</button></div>` : ""}
      <p class="form-error" role="alert"></p>`;
    dialog
      .querySelector<HTMLFormElement>("form")!
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        if (busy) return;
        const form = new FormData(event.currentTarget as HTMLFormElement);
        const name = String(form.get("name") || "").trim();
        await perform(async () => {
          const preview = await request("/api/organization", {
            action: "organization-preview",
            keepIds: form.getAll("keep"),
            ...(name ? { seed: { name, kind: form.get("kind") } } : {}),
            reason: nodes.length
              ? "Keep selected research nodes"
              : `Add starting point: ${name}`,
          });
          previewId = preview.id;
          const panel = dialog.querySelector<HTMLElement>(
            "#organization-preview",
          )!;
          panel.hidden = false;
          panel.innerHTML = `<h3>Review organization</h3><p>${preview.removed.length} node${preview.removed.length === 1 ? "" : "s"} removed · ${preview.added.length} added · ${preview.remaining.length} remaining</p>${preview.removed.length ? `<p><strong>Remove:</strong> ${preview.removed.map((n: any) => escape(n.name)).join(", ")}</p>` : ""}<p><strong>Result:</strong> ${preview.remaining.length ? preview.remaining.map((n: any) => escape(n.name)).join(", ") : "An empty research surface"}</p><p class="muted">A snapshot of the current graph will be saved for undo.</p><button type="button" class="primary" data-apply-organization>Apply organization</button>`;
          panel.scrollIntoView({ block: "nearest" });
        });
      });
    dialog.querySelector("form")!.addEventListener("input", () => {
      previewId = undefined;
      dialog.querySelector<HTMLElement>("#organization-preview")!.hidden = true;
    });
    if (!dialog.open) dialog.showModal();
  }
  async function perform(operation: () => Promise<void>) {
    busy = true;
    dialog.querySelector(".form-error")!.textContent = "";
    dialog
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => (b.disabled = true));
    try {
      await operation();
    } catch (error) {
      dialog.querySelector(".form-error")!.textContent = (
        error as Error
      ).message;
    } finally {
      busy = false;
      dialog
        .querySelectorAll<HTMLButtonElement>("button")
        .forEach((b) => (b.disabled = false));
    }
  }
  dialog.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "button",
    );
    if (!button || busy) return;
    if (button.hasAttribute("data-close-organization")) dialog.close();
    else if (button.dataset.selectNodes) {
      dialog
        .querySelectorAll<HTMLInputElement>("input[name=keep]")
        .forEach((i) => (i.checked = button.dataset.selectNodes === "all"));
      previewId = undefined;
      dialog.querySelector<HTMLElement>("#organization-preview")!.hidden = true;
    } else if (button.hasAttribute("data-apply-organization") && previewId)
      void perform(async () => {
        await request("/api/organization", {
          action: "organization-apply",
          previewId,
        });
        await refresh();
        dialog.close();
        notify("Graph organized. History and an undo snapshot are saved.");
      });
    else if (button.dataset.undoOrganization)
      void perform(async () => {
        await request("/api/organization", {
          action: "organization-undo",
          undoId: button.dataset.undoOrganization,
        });
        await refresh();
        dialog.close();
        notify("Previous graph restored. Research history remains saved.");
      });
  });
  document
    .querySelectorAll("[data-organize-project]")
    .forEach((b) => b.addEventListener("click", show));
}
