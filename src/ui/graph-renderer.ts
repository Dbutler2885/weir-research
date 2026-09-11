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
  private resizeTimer?: number;

  constructor(container: HTMLElement, handlers: GraphRendererHandlers) {
    this.handlers = handlers;
    this.svg = select(container)
      .append("svg")
      .attr("class", "family-graph")
      .attr("role", "graphics-document")
      .attr(
        "aria-label",
        "Interactive research graph. Select a person, place, or organization to focus its relationships.",
      );

    const defs = this.svg.append("defs");
    const filter = defs
      .append("filter")
      .attr("id", "focus-shadow")
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
    this.edgeLabelLayer = this.viewport
      .append("g")
      .attr("class", "edge-label-layer");
    this.nodeLayer = this.viewport.append("g").attr("class", "node-layer");

    this.zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.08, 2.4])
      .on("zoom", (event) => {
        this.currentTransform = event.transform;
        this.viewport.attr("transform", event.transform.toString());
      });
    this.svg.call(this.zoomBehavior);
    this.svg.on("dblclick.zoom", null);

    const resizeObserver = new ResizeObserver(() => {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        if (this.currentLayout) {
          this.centerOn(this.currentLayout.focusId, false);
        }
      }, 120);
    });
    resizeObserver.observe(container);
  }

  render(
    layout: FamilyLayout,
    projection: FocusProjection,
    model: GenealogyModel,
  ): void {
    this.currentLayout = layout;
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

    const contextEdgeLabels = layout.edges.filter(
      (edge) => edge.kind === "context" && edge.label,
    );
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
      .attr("x", (edge) => edge.points[Math.floor(edge.points.length / 2)]!.x)
      .attr(
        "y",
        (edge) => edge.points[Math.floor(edge.points.length / 2)]!.y - 7,
      )
      .attr("opacity", (edge) => {
        const source = layout.nodes.find((node) => node.id === edge.sourceId);
        const target = layout.nodes.find((node) => node.id === edge.targetId);
        return Math.max(
          source ? nodeOpacity(source) : 0.3,
          target ? nodeOpacity(target) : 0.3,
        );
      })
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
    window.requestAnimationFrame(() =>
      this.centerOn(layout.focusId, duration > 0),
    );
  }

  clear(): void {
    this.viewport.selectAll("*").interrupt();
    this.nodeLayer.selectAll("*").remove();
    this.edgeLayer.selectAll("*").remove();
    this.edgeLabelLayer.selectAll("*").remove();
    this.currentLayout = undefined;
    this.hasRendered = false;
  }

  fitAll(animate = true): void {
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
      .attr("title", `Open biography for ${person.name}`)
      .attr("data-lavish-action", "true")
      .text("i")
      .on("click", (event) => {
        event.stopPropagation();
        this.handlers.onOpenDetails(person.id);
      });

    group
      .append("title")
      .text(
        [
          person.name,
          person.lifespan,
          person.descriptor,
          `Relationship to focus: ${projected?.role ?? "remote"}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
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
    group
      .append("title")
      .text(
        union.label ??
          union.partnerIds.map((id) => model.getPerson(id).name).join(" + "),
      );
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
      .attr("height", 34)
      .append("xhtml:div")
      .attr("class", "context-name")
      .text(entity.name);

    group
      .append("foreignObject")
      .attr("x", 14)
      .attr("y", 61)
      .attr("width", node.width - 28)
      .attr("height", 14)
      .append("xhtml:div")
      .attr("class", "context-descriptor")
      .text(entity.descriptor ?? entity.activeDates ?? "Historical context");

    group
      .append("title")
      .text(
        [entity.name, entity.activeDates, entity.descriptor]
          .filter(Boolean)
          .join("\n"),
      );
  }
}
