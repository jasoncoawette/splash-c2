import "./fleetGraph.css";
import { centroidOf, type ScreenPoint } from "./selectionGeometry";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Class names shared with fleetGraph.css and with the drag controller. */
export const GRAPH_CLASS = {
  overlay: "fleet-graph",
  edge: "fleet-graph-edge",
  node: "fleet-graph-node",
  hub: "fleet-graph-hub",
  hubRing: "fleet-graph-hub-ring",
  hubDot: "fleet-graph-hub-dot",
  hubTick: "fleet-graph-hub-tick",
  hubCount: "fleet-graph-hub-count",
  readout: "fleet-graph-readout",
  marquee: "fleet-marquee",
  handle: "fleet-drag-handle",
} as const;

export interface GraphNode extends ScreenPoint {
  id: string;
}

export interface GraphFrame {
  nodes: readonly GraphNode[];
  /** True while the group is being dragged, which animates the links. */
  active: boolean;
  /** Short distance and bearing shown at the anchor during a drag. */
  readout: string | null;
}

export interface FleetGraphOverlay {
  element: SVGSVGElement;
  /** The group anchor. Decoration: it marks the centre and takes no presses. */
  hub: SVGGElement;
  draw: (frame: GraphFrame) => void;
  clear: () => void;
  destroy: () => void;
}

function createElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NAMESPACE, tag);

  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }

  return element;
}

function edgePath(from: ScreenPoint, to: ScreenPoint): string {
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

export function createFleetGraphOverlay(): FleetGraphOverlay {
  const element = createElement("svg", { class: GRAPH_CLASS.overlay });
  element.dataset.visible = "false";
  element.dataset.active = "false";
  element.setAttribute("aria-hidden", "true");

  const edgeLayer = createElement("g");
  const nodeLayer = createElement("g");
  const hub = createElement("g", { class: GRAPH_CLASS.hub });
  const readout = createElement("text", { class: GRAPH_CLASS.readout });

  element.append(edgeLayer, nodeLayer, hub, readout);

  const edges = new Map<string, SVGPathElement>();
  const nodes = new Map<string, SVGCircleElement>();

  function prune(
    pool: Map<string, SVGElement>,
    live: ReadonlySet<string>,
  ): void {
    for (const [id, shape] of pool) {
      if (live.has(id)) continue;
      shape.remove();
      pool.delete(id);
    }
  }

  return {
    element,
    hub,

    draw(frame) {
      // A map that has no size yet projects to Infinity; drawing that would put
      // Infinity into the path data, so those nodes are dropped.
      const drawable = frame.nodes.filter(
        (node) => Number.isFinite(node.x) && Number.isFinite(node.y),
      );
      const anchor = centroidOf(drawable);

      // One boat needs no graph: the selection halo already says which hull it
      // is, and a single link to its own position would be a dot.
      if (!anchor || drawable.length < 2) {
        this.clear();
        return;
      }

      element.dataset.visible = "true";
      element.dataset.active = frame.active ? "true" : "false";

      const ordered = [...drawable].sort((first, second) => (
        Math.atan2(first.y - anchor.y, first.x - anchor.x)
        - Math.atan2(second.y - anchor.y, second.x - anchor.x)
      ));
      const pairs = ordered.length === 2
        ? [[ordered[0], ordered[1]]] as const
        : ordered.map((node, index) => [node, ordered[(index + 1) % ordered.length]] as const);
      const live = new Set(pairs.map(([from, to]) => `${from.id}:${to.id}`));
      prune(edges, live);
      prune(nodes, new Set(drawable.map((node) => node.id)));

      for (const [from, to] of pairs) {
        const id = `${from.id}:${to.id}`;
        let edge = edges.get(id);

        if (!edge) {
          edge = createElement("path", { class: GRAPH_CLASS.edge });
          edges.set(id, edge);
          edgeLayer.append(edge);
        }

        edge.setAttribute("d", edgePath(from, to));
      }

      for (const node of drawable) {
        let dot = nodes.get(node.id);

        if (!dot) {
          dot = createElement("circle", { class: GRAPH_CLASS.node, r: 4.2 });
          nodes.set(node.id, dot);
          nodeLayer.append(dot);
        }

        dot.setAttribute("cx", String(node.x));
        dot.setAttribute("cy", String(node.y));
      }

      readout.setAttribute("x", String(anchor.x));
      readout.setAttribute("y", String(anchor.y - 26));
      readout.textContent = frame.readout ?? "";
    },

    clear() {
      element.dataset.visible = "false";
      element.dataset.active = "false";
      readout.textContent = "";

      for (const edge of edges.values()) edge.remove();
      for (const dot of nodes.values()) dot.remove();
      edges.clear();
      nodes.clear();
    },

    destroy() {
      this.clear();
      element.remove();
    },
  };
}
