import {
  select,
  zoom,
  zoomIdentity,
  type Selection,
  type ZoomBehavior,
  type ZoomTransform,
} from "d3";
import { GenealogyModel } from "../domain/model";
import type { FocusProjection } from "../domain/types";
import type { FamilyLayout, LayoutEdge, LayoutNode } from "../layout/layout";

export interface GraphRendererHandlers {
  onFocus: (personId: string) => void;
  onOpenDetails: (personId: string) => void;
  onOpenContextEntity: (entityId: string) => void;
}

function pathFromPoints(edge: LayoutEdge): string {
  if (edge.curved) {
    const [a, control, b] = edge.points;
    return `M${a!.x},${a!.y} Q${control!.x},${control!.y} ${b!.x},${b!.y}`;
  }
  return edge.points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
}

function nodeOpacity(node: LayoutNode): number {
  return {
    focus: 1,
    immediate: 0.96,
    near: 0.72,
    remote: 0.3,
  }[node.emphasis];
}

export class GraphRenderer {
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly viewport: Selection<SVGGElement, unknown, null, undefined>;
  private readonly edgeLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly edgeHitLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly edgeLabelLayer: Selection<
    SVGGElement,
    unknown,
    null,
    undefined
  >;
  private readonly nodeLayer: Selection<SVGGElement, unknown, null, undefined>;
  private readonly zoomBehavior: ZoomBehavior<SVGSVGElement, unknown>;
  private readonly handlers: GraphRendererHandlers;
  private currentLayout?: FamilyLayout;
  private currentTransform: ZoomTransform = zoomIdentity;
  private hasRendered = false;
  private selectedEdge?: string;
  private highlightedNode?: string;
  private highlightedEdge?: string;
  private readonly fitOnRender: boolean;
  private resizeTimer?: number;
  private tourRegion?: {nodeIds: string[]; claimIds: string[]};
  private readonly resizeObserver: ResizeObserver;

  constructor(
    container: HTMLElement,
    handlers: GraphRendererHandlers,
    fitOnRender = false,
  ) {
    this.fitOnRender = fitOnRender;
    this.handlers = handlers;
    this.svg = select(container)
      .append("svg")
      .attr("class", "family-graph")
      .attr("role", "graphics-document")
      .attr(
        "aria-label",
        "Interactive research graph. Select a person, place, or organization to focus its relationships.",
      );

    const shadowId = `focus-shadow-${crypto.randomUUID()}`;
    this.svg.style("--focus-shadow", `url(#${shadowId})`);
    const defs = this.svg.append("defs");
    const filter = defs
      .append("filter")
      .attr("id", shadowId)
      .attr("x", "-30%")
      .attr("y", "-30%")
      .attr("width", "160%")
      .attr("height", "160%");
    filter
      .append("feDropShadow")
      .attr("dx", 0)
      .attr("dy", 8)
      .attr("stdDeviation", 9)
      .attr("flood-color", "#142b35")
      .attr("flood-opacity", 0.22);

    this.viewport = this.svg.append("g").attr("class", "graph-viewport");
    this.edgeLayer = this.viewport.append("g").attr("class", "edge-layer");
    this.edgeHitLayer = this.viewport.append("g").attr("class", "edge-hit-layer");
    this.edgeLabelLayer = this.viewport
      .append("g")
      .attr("class", "edge-label-layer");
    this.nodeLayer = this.viewport.append("g").attr("class", "node-layer");

    this.zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.08, 2.4])
      .on("zoom", (event) => {
        this.currentTransform = event.transform;
        this.viewport.attr("transform", event.transform.toString());
        this.edgeLabelLayer.selectAll("text")
          .style("font-size", `${13 / event.transform.k}px`)
          .style("stroke-width", `${4 / event.transform.k}px`);
        this.highlight(this.highlightedNode, this.highlightedEdge);
      });
    this.svg.call(this.zoomBehavior);
    this.svg.on("dblclick.zoom", null);
    this.svg.on("click.relationship", (event: MouseEvent) => {
      if (event.target === this.svg.node()) {
        this.selectedEdge = undefined;
        this.highlight();
      }
    });

    this.resizeObserver = new ResizeObserver(() => {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        if (this.currentLayout) {
          if (this.tourRegion) this.focusRegion(this.tourRegion.nodeIds, this.tourRegion.claimIds);
          else if (this.fitOnRender) this.fitAll(false);
          else this.centerOn(this.currentLayout.focusId, false);
        }
      }, 120);
    });
    this.resizeObserver.observe(container);
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    window.clearTimeout(this.resizeTimer);
    this.svg.selectAll("*").interrupt();
    this.svg.interrupt().remove();
  }

  render(
    layout: FamilyLayout,
    projection: FocusProjection,
    model: GenealogyModel,
  ): void {
    this.currentLayout = layout;
    this.selectedEdge = undefined;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const duration = reduceMotion ? 0 : this.hasRendered ? 720 : 0;

    const edgeSelection = this.edgeLayer
      .selectAll<SVGPathElement, LayoutEdge>("path.graph-edge")
      .data(layout.edges, (edge) => edge.id);

    edgeSelection
      .exit()
      .transition()
      .duration(Math.min(duration, 240))
      .attr("opacity", 0)
      .remove();

    const edgeEnter = edgeSelection
      .enter()
      .append("path")
      .attr("class", "graph-edge")
      .attr("fill", "none")
      .attr("opacity", 0);

    edgeEnter
      .merge(edgeSelection)
      .attr("data-connection-id", (edge) =>
        edge.kind === "context" ? edge.id : null,
      )
      .attr("data-research-target", (edge) => {
        const direct = model.dataset.directParentage?.find(
          (link) => link.id === edge.id,
        );
        const union = [...model.unionsById.values()].find((item) =>
          edge.id.startsWith(`${item.id}:`),
        );
        return JSON.stringify({
          table:
            edge.kind === "context"
              ? "contextConnections"
              : direct
                ? "directParentage"
                : "unions",
          recordId: edge.kind === "context" || direct ? edge.id : union?.id,
          label: `${model.contextNodeName(edge.sourceId)} → ${model.contextNodeName(edge.targetId)}${edge.label ? `: ${edge.label}` : ""}`,
        });
      })
      .attr(
        "class",
        (edge) => `graph-edge ${edge.kind}-edge confidence-${edge.confidence}`,
      )
      .attr(
        "data-lavish-label",
        (edge) =>
          edge.label ??
          (edge.kind === "context"
            ? "Historical connection"
            : "Family relationship"),
      )
      .transition()
      .duration(duration)
      .attr("d", pathFromPoints)
      .attr("opacity", (edge) => {
        const source = layout.nodes.find((node) => node.id === edge.sourceId);
        const target = layout.nodes.find((node) => node.id === edge.targetId);
        return Math.max(
          source ? nodeOpacity(source) : 0.3,
          target ? nodeOpacity(target) : 0.3,
        );
      });

    const hits = this.edgeHitLayer.selectAll<SVGPathElement, LayoutEdge>("path").data(layout.edges, edge => edge.id);
    hits.exit().remove();
    hits.enter().append("path").merge(hits)
      .attr("class", "graph-edge-hit")
      .attr("d", pathFromPoints)
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", edge => `${model.contextNodeName(edge.sourceId)} → ${edge.label ?? "related to"} → ${model.contextNodeName(edge.targetId)}`)
      .attr("data-connection-id", edge => edge.kind === "context" ? edge.id : null)
      .attr("data-research-target", edge => this.edgeLayer.selectAll<SVGPathElement, LayoutEdge>("path.graph-edge").filter(candidate => candidate.id === edge.id).attr("data-research-target"))
      .attr("data-lavish-label", edge => edge.label ?? "Relationship")
      .on("pointerenter focus", (_event, edge) => this.highlight(undefined, edge.id))
      .on("pointerleave blur", () => this.highlight(undefined, this.selectedEdge))
      .on("click", (event: MouseEvent, edge) => {
        event.stopPropagation();
        this.selectedEdge = this.selectedEdge === edge.id ? undefined : edge.id;
        this.highlight(undefined, this.selectedEdge);
      })
      .on("keydown", (event: KeyboardEvent, edge) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.selectedEdge = this.selectedEdge === edge.id ? undefined : edge.id;
          this.highlight(undefined, this.selectedEdge);
        } else if (event.key === "Escape") {
          this.selectedEdge = undefined;
          this.highlight();
        }
      });

    const contextEdgeLabels = layout.edges.filter(edge => edge.label);
    const labelSelection = this.edgeLabelLayer
      .selectAll<SVGTextElement, LayoutEdge>("text.context-edge-label")
      .data(contextEdgeLabels, (edge) => edge.id);
    labelSelection.exit().remove();
    labelSelection
      .enter()
      .append("text")
      .attr("class", "context-edge-label")
      .merge(labelSelection)
      .attr("data-connection-id", (edge) => edge.id)
      .attr(
        "data-lavish-label",
        (edge) => edge.label ?? "Historical connection",
      )
      .attr("x", (edge) => this.labelPosition(edge).x)
      .attr(
        "y",
        (edge) => this.labelPosition(edge).y - 9,
      )
      .attr("visibility", "hidden")
      .text((edge) => edge.label ?? "");

    const nodeSelection = this.nodeLayer
      .selectAll<SVGGElement, LayoutNode>("g.graph-node")
      .data(layout.nodes, (node) => node.id);

    nodeSelection
      .exit()
      .transition()
      .duration(Math.min(duration, 240))
      .attr("opacity", 0)
      .remove();

    const nodeEnter = nodeSelection
      .enter()
      .append("g")
      .attr("class", "graph-node")
      .attr("opacity", 0)
      .attr(
        "transform",
        (node) =>
          `translate(${node.x + node.width / 2},${node.y + node.height / 2})`,
      );

    const merged = nodeEnter.merge(nodeSelection);
    merged
      .on("pointerenter focusin", (_event, node) => this.highlight(node.id))
      .on("pointerleave focusout", () => this.highlight(undefined, this.selectedEdge))
      .attr("class", (node) => {
        const focusClass = node.id === projection.focusId ? " is-focus" : "";
        return `graph-node ${node.kind}-node emphasis-${node.emphasis}${focusClass}`;
      })
      .attr("data-person-id", (node) => node.personId ?? null)
      .attr("data-union-id", (node) => node.unionId ?? null)
      .attr("data-context-entity-id", (node) => node.contextEntityId ?? null)
      .attr("data-lavish-label", (node) => {
        if (node.personId) {
          return model.getPerson(node.personId).name;
        }
        if (node.unionId) {
          const union = model.getUnion(node.unionId);
          return union.label ?? "Family union";
        }
        return model.getContextEntity(node.contextEntityId!).name;
      })
      .each((node, index, groups) => {
        const group = select<SVGGElement, LayoutNode>(groups[index]!);
        group.selectAll("*").remove();
        if (node.kind === "person" && node.personId) {
          this.renderPersonNode(group, node, model, projection);
        } else if (node.unionId) {
          this.renderUnionNode(group, node, model);
        } else if (node.contextEntityId) {
          this.renderContextNode(group, node, model);
        }
      })
      .transition()
      .duration(duration)
      .attr("opacity", nodeOpacity)
      .attr("transform", (node) => `translate(${node.x},${node.y})`);

    this.hasRendered = true;
    this.highlight();
    window.requestAnimationFrame(() =>
      this.fitOnRender
        ? this.fitAll(false)
        : this.centerOn(layout.focusId, duration > 0),
    );
  }

  clear(): void {
    this.viewport.selectAll("*").interrupt();
    this.nodeLayer.selectAll("*").remove();
    this.edgeLayer.selectAll("*").remove();
    this.edgeHitLayer.selectAll("*").remove();
    this.edgeLabelLayer.selectAll("*").remove();
    this.currentLayout = undefined;
    this.hasRendered = false;
  }

  fitAll(animate = true): void {
    this.tourRegion = undefined;
    const layout = this.currentLayout;
    const svgNode = this.svg.node();
    if (!layout || !svgNode || layout.width <= 0 || layout.height <= 0) {
      return;
    }

    const bounds = svgNode.getBoundingClientRect();
    const padding = 72;
    const scale = Math.max(
      0.08,
      Math.min(
        1,
        (bounds.width - padding * 2) / layout.width,
        (bounds.height - padding * 2) / layout.height,
      ),
    );
    const transform = zoomIdentity
      .translate(
        (bounds.width - layout.width * scale) / 2,
        (bounds.height - layout.height * scale) / 2,
      )
      .scale(scale);
    this.applyTransform(transform, animate ? 600 : 0);
  }

  centerOn(personId: string, animate = true): void {
    this.tourRegion = undefined;
    const layout = this.currentLayout;
    const svgNode = this.svg.node();
    const node = layout?.nodes.find((candidate) => candidate.id === personId);
    if (!layout || !svgNode || !node) {
      return;
    }

    const bounds = svgNode.getBoundingClientRect();
    const scale = Math.max(0.42, Math.min(0.82, this.currentTransform.k));
    const x = node.x + node.width / 2;
    const y = node.y + node.height / 2;
    const transform = zoomIdentity
      .translate(bounds.width / 2 - x * scale, bounds.height / 2 - y * scale)
      .scale(scale);
    this.applyTransform(transform, animate ? 720 : 0);
  }

  zoomBy(factor: number): void {
    this.svg.transition().duration(240).call(this.zoomBehavior.scaleBy, factor);
  }

  focusRegion(nodeIds: string[], claimIds: string[] = []): void {
    this.tourRegion = {nodeIds, claimIds};
    const layout = this.currentLayout, svg = this.svg.node();
    if (!layout || !svg) return;
    const ids = new Set(nodeIds);
    for (const edge of layout.edges) if (claimIds.includes(edge.id)) { ids.add(edge.sourceId); ids.add(edge.targetId); }
    const nodes = layout.nodes.filter(n => ids.has(n.id));
    if (!nodes.length) return;
    this.nodeLayer.selectAll<SVGGElement, LayoutNode>("g.graph-node").classed("is-tour-focus", n => ids.has(n.id));
    this.edgeLayer.selectAll<SVGPathElement, LayoutEdge>("path.graph-edge").classed("is-tour-focus", e => claimIds.includes(e.id));
    const left = Math.min(...nodes.map(n => n.x)), top = Math.min(...nodes.map(n => n.y));
    const right = Math.max(...nodes.map(n => n.x + n.width)), bottom = Math.max(...nodes.map(n => n.y + n.height));
    const bounds = svg.getBoundingClientRect();
    const scale = Math.max(0.08, Math.min(0.95, (bounds.width - 110) / (right - left + 180), (bounds.height - 110) / (bottom - top + 180)));
    this.applyTransform(zoomIdentity.translate(bounds.width / 2 - (left + right) / 2 * scale, bounds.height / 2 - (top + bottom) / 2 * scale).scale(scale), 0);
  }

  private labelPosition(edge: LayoutEdge): {x: number; y: number} {
    if (edge.curved) {
      const [a, c, b] = edge.points;
      return {x: (a!.x + 2 * c!.x + b!.x) / 4, y: (a!.y + 2 * c!.y + b!.y) / 4};
    }
    return edge.points[Math.floor(edge.points.length / 2)]!;
  }

  private highlight(nodeId?: string, edgeId?: string): void {
    this.highlightedNode = nodeId;
    this.highlightedEdge = edgeId;
    const layout = this.currentLayout;
    if (!layout) return;
    const active = Boolean(nodeId || edgeId);
    const edges = new Set(layout.edges.filter(edge => edgeId ? edge.id === edgeId : nodeId && (edge.sourceId === nodeId || edge.targetId === nodeId)).map(edge => edge.id));
    const nodes = new Set(nodeId ? [nodeId] : []);
    for (const edge of layout.edges) if (edges.has(edge.id)) {
      nodes.add(edge.sourceId); nodes.add(edge.targetId);
    }
    this.edgeLayer.selectAll<SVGPathElement, LayoutEdge>("path.graph-edge")
      .classed("is-muted", edge => active && !edges.has(edge.id))
      .classed("is-highlighted", edge => edges.has(edge.id));
    this.nodeLayer.selectAll<SVGGElement, LayoutNode>("g.graph-node")
      .classed("is-muted", node => active && !nodes.has(node.id))
      .classed("is-highlighted", node => active && nodes.has(node.id));
    // Reveal only labels that fit, leaving individual edges keyboard/hover accessible.
    const occupied = layout.nodes.map(node => ({x: node.x - 8, y: node.y - 8, width: node.width + 16, height: node.height + 16}));
    this.edgeLabelLayer.selectAll<SVGTextElement, LayoutEdge>("text")
      .attr("visibility", "hidden")
      .each((edge, index, elements) => {
        if (!edges.has(edge.id)) return;
        const label = elements[index]!;
        const box = label.getBBox();
        const overlaps = occupied.some(other => box.x < other.x + other.width && box.x + box.width > other.x && box.y < other.y + other.height && box.y + box.height > other.y);
        if (!overlaps || edgeId) {
          label.setAttribute("visibility", "visible");
          occupied.push({x: box.x - 8, y: box.y - 6, width: box.width + 16, height: box.height + 12});
        }
      });
  }

  private applyTransform(transform: ZoomTransform, duration: number): void {
    if (duration === 0) {
      this.svg.call(this.zoomBehavior.transform, transform);
      return;
    }
    this.svg
      .transition()
      .duration(duration)
      .call(this.zoomBehavior.transform, transform);
  }

  private renderPersonNode(
    group: Selection<SVGGElement, LayoutNode, null, undefined>,
    node: LayoutNode,
    model: GenealogyModel,
    projection: FocusProjection,
  ): void {
    const person = model.getPerson(node.personId!);
    const projected = projection.people.get(person.id);
    group
      .attr("role", "button")
      .attr("tabindex", 0)
      .attr(
        "aria-label",
        `${person.name}${person.lifespan ? `, ${person.lifespan}` : ""}. ${
          projected?.role === "focus"
            ? "Current focus."
            : `Relationship: ${projected?.role ?? "remote"}.`
        }`,
      )
      .on("click", () => this.handlers.onFocus(person.id))
      .on("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.handlers.onFocus(person.id);
        }
      });

    group
      .append("rect")
      .attr("class", "person-card")
      .attr("width", node.width)
      .attr("height", node.height)
      .attr("rx", 12);

    group
      .append("foreignObject")
      .attr("class", "person-name-object")
      .attr("x", 16)
      .attr("y", 12)
      .attr("width", node.width - 60)
      .attr("height", 39)
      .append("xhtml:div")
      .attr("class", "person-name")
      .text(person.name);

    group
      .append("text")
      .attr("class", "person-lifespan")
      .attr("x", 16)
      .attr("y", 63)
      .text(person.lifespan ?? "Dates not yet verified");

    group
      .append("text")
      .attr("class", "person-descriptor")
      .attr("x", 16)
      .attr("y", 87)
      .text(person.descriptor ?? projected?.role ?? "Person record");

    const foreignObject = group
      .append("foreignObject")
      .attr("x", node.width - 39)
      .attr("y", 10)
      .attr("width", 30)
      .attr("height", 30);
    foreignObject
      .append("xhtml:button")
      .attr("type", "button")
      .attr("class", "node-info-button")
      .attr("aria-label", `Open biography for ${person.name}`)
      .attr("data-lavish-action", "true")
      .text("i")
      .on("click", (event) => {
        event.stopPropagation();
        this.handlers.onOpenDetails(person.id);
      });
  }

  private renderUnionNode(
    group: Selection<SVGGElement, LayoutNode, null, undefined>,
    node: LayoutNode,
    model: GenealogyModel,
  ): void {
    const union = model.getUnion(node.unionId!);
    group
      .attr("role", "img")
      .attr(
        "aria-label",
        union.label ??
          `Union of ${union.partnerIds
            .map((id) => model.getPerson(id).name)
            .join(" and ")}`,
      );
    group
      .append("circle")
      .attr(
        "class",
        `union-mark confidence-${union.confidence ?? "established"}`,
      )
      .attr("cx", node.width / 2)
      .attr("cy", node.height / 2)
      .attr("r", node.width / 2);
  }

  private renderContextNode(
    group: Selection<SVGGElement, LayoutNode, null, undefined>,
    node: LayoutNode,
    model: GenealogyModel,
  ): void {
    const entity = model.getContextEntity(node.contextEntityId!);
    group
      .attr("role", "button")
      .attr("tabindex", 0)
      .attr(
        "aria-label",
        `${entity.name}. ${entity.descriptor ?? entity.kind}. Open historical connections.`,
      )
      .on("click", () => this.handlers.onOpenContextEntity(entity.id))
      .on("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.handlers.onOpenContextEntity(entity.id);
        }
      });

    group
      .append("rect")
      .attr("class", `context-card context-${entity.kind}`)
      .attr("width", node.width)
      .attr("height", node.height)
      .attr("rx", 10);

    group
      .append("text")
      .attr("class", "context-kind")
      .attr("x", 14)
      .attr("y", 19)
      .text(
        entity.kind === "family" ? "FAMILY NETWORK" : entity.kind.toUpperCase(),
      );

    group
      .append("foreignObject")
      .attr("x", 14)
      .attr("y", 25)
      .attr("width", node.width - 28)
      .attr("height", node.height - 48)
      .append("xhtml:div")
      .attr("class", "context-name")
      .text(entity.name);

    group
      .append("foreignObject")
      .attr("x", 14)
      .attr("y", node.height - 21)
      .attr("width", node.width - 28)
      .attr("height", 14)
      .append("xhtml:div")
      .attr("class", "context-descriptor")
      .text(entity.descriptor ?? entity.activeDates ?? "Historical context");
  }
}
