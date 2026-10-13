import type { Map as MapboxMap } from "mapbox-gl";
import type { Position } from "../../core/types";
import "./cursors.css";
import { createFleetGraphOverlay, GRAPH_CLASS, type GraphNode } from "./fleetGraph";
import {
  exceedsDragThreshold,
  mergeSelection,
  pointsInside,
  rectangleBetween,
  type IdentifiedPoint,
  type ScreenPoint,
} from "./selectionGeometry";

/** Travel, in pixels, under which a drag is really a click. */
const CLICK_SLOP = 4;

export interface GroupDragBoat {
  id: string;
  longitude: number;
  latitude: number;
}

export interface GroupDragHost {
  map: MapboxMap;
  /** The element the map is mounted in; the overlay is drawn over it. */
  container: HTMLElement;
  onSelectionChange: (ids: readonly string[]) => void;
}

export interface ChartSelection {
  setBoats: (boats: readonly GroupDragBoat[]) => void;
  setSelection: (ids: readonly string[]) => void;
  /** Make one marker element a select target for its boat. Safe to call twice. */
  attachHandle: (boatId: string, element: HTMLElement) => void;
  /**
   * Which chart tool is live. Selecting and the marquee belong to the select
   * tool; under a placement tool a press on the water is the chart's, so this
   * controller keeps its hands off it entirely.
   */
  setTool: (tool: string) => void;
  /**
   * Swallow the browser click that trails a gesture on the chart. Any chart
   * gesture that drags should call this on pointerup, so a map click handler
   * never has to tell a real click from the end of a drag.
   */
  swallowNextClick: () => void;
  refresh: () => void;
  destroy: () => void;
}

interface MarqueeState {
  pointerId: number;
  origin: ScreenPoint;
  rect: DOMRect;
  additive: boolean;
}

function isAdditive(event: PointerEvent | MouseEvent): boolean {
  return event.shiftKey || event.metaKey || event.ctrlKey;
}

/** Holding a modifier asks for the camera instead of the selection. */
function wantsCamera(event: PointerEvent): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey || event.altKey;
}

/**
 * Selection on the chart.
 *
 * A click takes a hull, a modified click adds or removes one, and shift-drag
 * over open water draws a marquee — the way a canvas does, because the map owns
 * plain drag for panning. Nothing here moves a vessel: a boat is tasked by
 * placing an objective or raising a perimeter, never by dragging it somewhere,
 * because a position is not an order.
 */
export function createChartSelection(host: GroupDragHost): ChartSelection {
  const { map, container } = host;
  const overlay = createFleetGraphOverlay();
  const marqueeElement = document.createElement("div");

  marqueeElement.className = GRAPH_CLASS.marquee;
  marqueeElement.dataset.visible = "false";
  container.append(overlay.element, marqueeElement);

  // Drag is selection, not navigation. The chart is a place you pick things on,
  // so a plain drag draws a marquee and the camera moves only when asked for
  // with a modifier. Mapbox's own drag and box zoom are off until then.
  map.boxZoom.disable();
  map.dragPan.disable();

  let boats: readonly GroupDragBoat[] = [];
  let selection: readonly string[] = [];
  let tool = "SELECT";
  let marquee: MarqueeState | null = null;
  // A gesture that moved still ends in a browser click on the chart. That click
  // is a side effect of this controller, so this controller eats it rather than
  // leaving every other map click handler to guess where it came from.
  let swallowClick = false;
  const boundHandles = new WeakMap<HTMLElement, string>();

  function positionOf(id: string): Position | null {
    const boat = boats.find((candidate) => candidate.id === id);
    return boat ? { latitude: boat.latitude, longitude: boat.longitude } : null;
  }

  function pointIn(rect: DOMRect, event: PointerEvent): ScreenPoint {
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function setDragCursor(state: "marquee" | null): void {
    if (state) {
      document.body.dataset.chartDrag = state;
    } else {
      delete document.body.dataset.chartDrag;
    }
  }

  function refresh(): void {
    const nodes: GraphNode[] = [];

    for (const id of selection) {
      const position = positionOf(id);
      if (!position) continue;

      const point = map.project([position.longitude, position.latitude]);
      nodes.push({ id, x: point.x, y: point.y });
    }

    overlay.draw({ nodes, active: false, readout: null });
  }

  function endMarquee(): void {
    setDragCursor(null);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);
    window.removeEventListener("keydown", handleKeyDown);
    document.body.style.removeProperty("user-select");
    marqueeElement.dataset.visible = "false";
  }

  function startMarquee(event: PointerEvent): void {
    const rect = container.getBoundingClientRect();
    const origin = pointIn(rect, event);

    marquee = {
      pointerId: event.pointerId,
      origin,
      rect,
      // Plain drag replaces the selection. Nothing adds yet: the modifiers
      // belong to the camera now, and shift-click on a hull still adds one.
      additive: false,
    };

    setDragCursor("marquee");
    marqueeElement.dataset.visible = "true";
    marqueeElement.style.left = `${origin.x}px`;
    marqueeElement.style.top = `${origin.y}px`;
    marqueeElement.style.width = "0px";
    marqueeElement.style.height = "0px";

    document.body.style.setProperty("user-select", "none");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("keydown", handleKeyDown);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!marquee || event.pointerId !== marquee.pointerId) return;

    const box = rectangleBetween(marquee.origin, pointIn(marquee.rect, event));
    marqueeElement.style.left = `${box.left}px`;
    marqueeElement.style.top = `${box.top}px`;
    marqueeElement.style.width = `${box.width}px`;
    marqueeElement.style.height = `${box.height}px`;
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!marquee || event.pointerId !== marquee.pointerId) return;

    const box = rectangleBetween(marquee.origin, pointIn(marquee.rect, event));
    const additive = marquee.additive;

    // A press that never travelled is a click, not a marquee. It used to be
    // treated as a zero-sized box anyway, which selected nothing and — worse —
    // swallowed the click on its way out, so the chart's own click handler
    // never ran under the select tool. That is what made live traffic
    // unpickable: the contact was there, the query found it, and the event
    // never arrived. A click is handed back to the chart to answer.
    if (box.width < CLICK_SLOP && box.height < CLICK_SLOP) {
      marquee = null;
      endMarquee();
      return;
    }

    marquee = null;
    swallowClick = true;
    endMarquee();

    const points: IdentifiedPoint[] = boats.map((boat) => {
      const point = map.project([boat.longitude, boat.latitude]);
      return { id: boat.id, x: point.x, y: point.y };
    });
    const caught = pointsInside(points, box);

    if (additive) {
      const merged = [...selection];
      for (const id of caught) if (!merged.includes(id)) merged.push(id);
      host.onSelectionChange(merged);
    } else {
      host.onSelectionChange(caught);
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !marquee) return;

    marquee = null;
    endMarquee();
  }

  function handleContainerPointerDown(event: PointerEvent): void {
    swallowClick = false;
    if (event.button !== 0 || marquee) return;

    // A modifier hands the gesture to the camera for its duration.
    if (wantsCamera(event)) {
      map.dragPan.enable();
      const release = () => {
        map.dragPan.disable();
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", release);
      };
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", release);
      return;
    }

    if (tool !== "SELECT") return;
    startMarquee(event);
  }

  function handleContainerClick(event: MouseEvent): void {
    if (!swallowClick) return;

    swallowClick = false;
    event.stopPropagation();
    event.preventDefault();
  }

  container.addEventListener("pointerdown", handleContainerPointerDown);
  container.addEventListener("click", handleContainerClick, true);
  map.on("move", refresh);
  map.on("resize", refresh);

  return {
    setBoats(nextBoats) {
      boats = [...nextBoats];
      refresh();
    },

    setSelection(ids) {
      selection = [...ids];
      refresh();
    },

    attachHandle(boatId, element) {
      if (boundHandles.get(element) === boatId) return;

      boundHandles.set(element, boatId);
      element.classList.add(GRAPH_CLASS.handle);
      element.addEventListener("pointerdown", (event) => {
        // Under a placement tool the press is the chart's: it must reach the
        // map so the objective or perimeter lands where it was aimed.
        if (tool !== "SELECT") return;
        if (event.button !== 0 || marquee) return;

        const origin = { x: event.clientX, y: event.clientY };
        const pointerId = event.pointerId;

        // A press that travels is the operator panning the chart from a hull,
        // which is not a pick. Only a press that stays put selects.
        function finish(up: PointerEvent): void {
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", finish);
          if (up.pointerId !== pointerId) return;
          if (exceedsDragThreshold(origin, { x: up.clientX, y: up.clientY })) return;

          host.onSelectionChange(mergeSelection(selection, boatId, isAdditive(up)));
        }

        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
      });
    },

    setTool(next) {
      tool = next;
      // An armed placement tool shows a crosshair over the whole chart.
      container.dataset.chartCursor = next === "SELECT" ? "select" : "place";
    },

    swallowNextClick() {
      swallowClick = true;
    },

    refresh,

    destroy() {
      marquee = null;
      endMarquee();
      container.removeEventListener("pointerdown", handleContainerPointerDown);
      container.removeEventListener("click", handleContainerClick, true);
      map.off("move", refresh);
      map.off("resize", refresh);
      map.boxZoom.enable();
      map.dragPan.enable();
      setDragCursor(null);
      delete container.dataset.chartCursor;
      overlay.destroy();
      marqueeElement.remove();
    },
  };
}

/** @deprecated Kept so existing imports keep working; selection has no drag. */
export const createGroupDrag = createChartSelection;
export type GroupDrag = ChartSelection;
