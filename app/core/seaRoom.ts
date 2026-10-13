import { LAND_MASK } from "./landMask.ts";
import { distanceBetween, moveToward } from "./navigation.ts";
import type { Position } from "./types";

// SEA ROOM
//
// The one place that answers "may a boat be here". Pure: it reads a baked mask
// and nothing else, so a run replays and the core still touches no clock, no
// network and no platform API.
//
// Outside the mask the answer is yes. The mask covers the operating area, and a
// boat beyond it is in open water as far as this module knows — saying "land"
// out there would strand a boat that left the box rather than protect it.

const CELL_BITS = decodeMask();

function decodeMask(): Uint8Array {
  const binary = typeof atob === "function"
    ? atob(LAND_MASK.base64)
    : Buffer.from(LAND_MASK.base64, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Half a cell, in nautical miles: the finest step worth taking along a track. */
const CELL_NM = ((LAND_MASK.north - LAND_MASK.south) / LAND_MASK.rows) * 60;
const STEP_NM = CELL_NM / 2;

export function isLand(position: Position): boolean {
  const { west, east, south, north, cols, rows } = LAND_MASK;
  const { latitude, longitude } = position;

  if (longitude < west || longitude > east || latitude < south || latitude > north) {
    return false;
  }

  const column = Math.min(
    cols - 1,
    Math.max(0, Math.floor(((longitude - west) / (east - west)) * cols)),
  );
  const row = Math.min(
    rows - 1,
    Math.max(0, Math.floor(((north - latitude) / (north - south)) * rows)),
  );

  const cell = row * cols + column;
  return (CELL_BITS[cell >> 3] & (1 << (cell & 7))) !== 0;
}

export function isNavigable(position: Position): boolean {
  return !isLand(position);
}

/**
 * How far a boat may run along a track before it would touch land.
 *
 * Walks the segment at half-cell steps rather than only testing the endpoint,
 * because a fast boat on a long tick can step clean over a spit and land back
 * in water on the far side. Returns the last position that is still water,
 * which is `from` when the very next step is already aground.
 */
export function clampToWater(from: Position, to: Position): Position {
  // A boat that is already ashore — seeded there, dragged there, or outside
  // anything this mask knows — is not imprisoned by it. The rule stops a boat
  // driving onto land; it cannot reason about sea room from a start that has
  // none, and freezing the boat there would be worse than letting it move.
  if (isLand(from)) return to;

  if (isNavigable(to)) {
    const distanceNm = distanceBetween(from, to);
    if (distanceNm <= STEP_NM) return to;

    const steps = Math.ceil(distanceNm / STEP_NM);
    let safe = from;

    for (let step = 1; step <= steps; step += 1) {
      const probe = moveToward(from, to, (distanceNm * step) / steps);
      if (isLand(probe)) return safe;
      safe = probe;
    }

    return to;
  }

  // The destination is ashore: back off along the track to the last water.
  const distanceNm = distanceBetween(from, to);
  if (distanceNm === 0) return from;

  const steps = Math.ceil(distanceNm / STEP_NM);
  let safe = from;

  for (let step = 1; step <= steps; step += 1) {
    const probe = moveToward(from, to, (distanceNm * step) / steps);
    if (isLand(probe)) break;
    safe = probe;
  }

  return safe;
}

/**
 * True when a straight leg between two points would touch land.
 *
 * Both ends can sit in clean water and the line between them still cross a mole
 * or a spit, which is how a planned route ends up drawn through Terminal
 * Island. Walks the segment at the same half-cell steps as `clampToWater`, so
 * the planner and the helm agree on what counts as a crossing.
 */
export function crossesLand(from: Position, to: Position): boolean {
  const distanceNm = distanceBetween(from, to);
  if (distanceNm === 0) return isLand(from);

  const steps = Math.ceil(distanceNm / STEP_NM);

  for (let step = 0; step <= steps; step += 1) {
    if (isLand(moveToward(from, to, (distanceNm * step) / steps))) return true;
  }

  return false;
}

/** True when the move had to be cut short, which is what stops the engines. */
export function wasBlocked(intended: Position, allowed: Position): boolean {
  return distanceBetween(intended, allowed) > 1e-9;
}
