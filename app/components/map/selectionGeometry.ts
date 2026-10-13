import type { Position } from "../../core/types";

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenRectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface IdentifiedPoint extends ScreenPoint {
  id: string;
}

/**
 * How far a pointer must travel before a press on a boat stops being a click
 * that selects it and becomes a drag that moves the group.
 */
export const DRAG_THRESHOLD_PX = 3;

/** A marquee drawn from any corner to any corner, normalised to a positive box. */
export function rectangleBetween(from: ScreenPoint, to: ScreenPoint): ScreenRectangle {
  return {
    left: Math.min(from.x, to.x),
    top: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/** Edges count as inside, so a boat exactly on the marquee border is caught. */
export function containsPoint(rectangle: ScreenRectangle, point: ScreenPoint): boolean {
  return point.x >= rectangle.left
    && point.x <= rectangle.left + rectangle.width
    && point.y >= rectangle.top
    && point.y <= rectangle.top + rectangle.height;
}

export function pointsInside(
  points: readonly IdentifiedPoint[],
  rectangle: ScreenRectangle,
): string[] {
  return points.filter((point) => containsPoint(rectangle, point)).map((point) => point.id);
}

export function centroidOf(points: readonly ScreenPoint[]): ScreenPoint | null {
  if (points.length === 0) return null;

  let x = 0;
  let y = 0;

  for (const point of points) {
    x += point.x;
    y += point.y;
  }

  return { x: x / points.length, y: y / points.length };
}

export function exceedsDragThreshold(
  from: ScreenPoint,
  to: ScreenPoint,
  threshold: number = DRAG_THRESHOLD_PX,
): boolean {
  return Math.abs(to.x - from.x) >= threshold || Math.abs(to.y - from.y) >= threshold;
}

/**
 * The selection rule for a click on a boat. A plain click replaces the
 * selection; an additive click (shift, meta, or control) toggles one boat in or
 * out and leaves the rest alone. Selection order is kept, because the last boat
 * added is the one the detail panel reads.
 */
export function mergeSelection(
  current: readonly string[],
  id: string,
  additive: boolean,
): readonly string[] {
  if (!additive) {
    if (current.length === 1 && current[0] === id) return current;
    return [id];
  }

  if (current.includes(id)) {
    const next = current.filter((selectedId) => selectedId !== id);
    return next.length === current.length ? current : next;
  }

  return [...current, id];
}

/**
 * The group's anchor on the chart. A plain mean is accurate enough for a
 * harbour-sized fleet and keeps the anchor stable while boats are dragged.
 */
export function averagePosition(positions: readonly Position[]): Position | null {
  if (positions.length === 0) return null;

  let latitude = 0;
  let longitude = 0;

  for (const position of positions) {
    latitude += position.latitude;
    longitude += position.longitude;
  }

  return {
    latitude: latitude / positions.length,
    longitude: longitude / positions.length,
  };
}
