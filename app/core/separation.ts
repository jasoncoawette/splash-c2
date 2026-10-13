import { SAFETY_MARGIN_NM } from "./hull.ts";
import { advanceAlongHeading, bearingBetween, distanceBetween } from "./navigation.ts";
import { isNavigable } from "./seaRoom.ts";
import type { BoatId, Position } from "./types";

// KEEPING HULLS APART
//
// Two boats may not occupy the same water. This runs after every boat has
// moved, because separation is a property of the fleet and no single boat can
// see it.
//
// Deterministic by construction: pairs are visited in sorted-id order and each
// push is symmetric, so the same fleet and the same tick always produce the
// same positions whatever order the boats happen to be stored in.

export interface Hull {
  id: BoatId;
  position: Position;
  /** Half the hull's length, in nautical miles. */
  radiusNm: number;
}

/** A reported vessel the fleet does not control. */
export interface TrafficHazard {
  id: string;
  label?: string;
  position: Position;
  /** Half the reported ship length, in nautical miles. */
  radiusNm: number;
}

const TRACK_SAMPLE_NM = 5 / 1852;

/**
 * Stop a track before it enters another ship's safety bubble.
 *
 * The contact stays fixed for this one deterministic tick. A boat already
 * inside a newly reported bubble is allowed to move away, so late AIS does not
 * imprison it. Sampling the whole track prevents a fast tick jumping clean
 * over a narrow contact.
 */
export function clampToTraffic(
  start: Position,
  requested: Position,
  boatRadiusNm: number,
  hazards: readonly TrafficHazard[],
): Position {
  if (hazards.length === 0) return requested;

  const trackNm = distanceBetween(start, requested);
  if (trackNm < 1e-9) return requested;

  const course = bearingBetween(start, requested);
  const steps = Math.max(1, Math.ceil(trackNm / TRACK_SAMPLE_NM));
  const startingGaps = new Map(hazards.map((hazard) => [
    hazard.id,
    distanceBetween(start, hazard.position),
  ]));
  let lastClear = start;

  for (let step = 1; step <= steps; step += 1) {
    const candidate = step === steps
      ? requested
      : advanceAlongHeading(start, course, (trackNm * step) / steps);

    const conflict = hazards.some((hazard) => {
      const minimumNm = boatRadiusNm + hazard.radiusNm + SAFETY_MARGIN_NM;
      const startGap = startingGaps.get(hazard.id) as number;
      const candidateGap = distanceBetween(candidate, hazard.position);

      if (candidateGap >= minimumNm) return false;
      // If the report arrived around us, only refuse movement that makes the
      // situation worse. A course opening the range remains available.
      return startGap >= minimumNm || candidateGap < startGap;
    });

    if (conflict) return lastClear;
    lastClear = candidate;
  }

  return requested;
}

/** Enough passes to settle a cluster without letting a crowd run away with it. */
const PASSES = 4;

export function separateHulls(hulls: readonly Hull[]): Map<BoatId, Position> {
  const ordered = [...hulls].sort((first, second) => (first.id < second.id ? -1 : 1));
  const moved = new Map<BoatId, Position>(ordered.map((hull) => [hull.id, hull.position]));

  for (let pass = 0; pass < PASSES; pass += 1) {
    let touched = false;

    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const first = ordered[i];
        const second = ordered[j];
        const here = moved.get(first.id) as Position;
        const there = moved.get(second.id) as Position;

        const minimumNm = first.radiusNm + second.radiusNm + SAFETY_MARGIN_NM;
        const gapNm = distanceBetween(here, there);
        if (gapNm >= minimumNm) continue;

        touched = true;

        // Two hulls exactly on top of each other have no bearing to push along,
        // so break the tie on their ids rather than leaving them welded.
        const bearing = gapNm < 1e-9
          ? (first.id < second.id ? 0 : 180)
          : bearingBetween(here, there);
        const push = (minimumNm - gapNm) / 2;

        const firstMoved = advanceAlongHeading(here, (bearing + 180) % 360, push);
        const secondMoved = advanceAlongHeading(there, bearing, push);

        // A push must never shove a boat ashore; it stays put if it would.
        if (isNavigable(firstMoved)) moved.set(first.id, firstMoved);
        if (isNavigable(secondMoved)) moved.set(second.id, secondMoved);
      }
    }

    if (!touched) break;
  }

  return moved;
}
