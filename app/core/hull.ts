import type { BoatType } from "./types";

/**
 * True hull dimensions, in metres. The source of truth for both the procedural
 * models and the separation rule, so a hull cannot be one length to the chart
 * and another to the simulator.
 */
export const HULL_LENGTH_M: Record<BoatType, number> = {
  TYPHOON: 3.9,
  TEMPEST: 7.2,
};

/**
 * The bubble an autonomous hull keeps around itself, beyond its own length.
 *
 * This is a closest-point-of-approach margin, not hull contact: boats that pass
 * this close have already failed to keep clear. It is deliberately larger than
 * the hulls, because the thing being prevented is a collision, not a scrape.
 */
export const SAFETY_MARGIN_M = 25;

const METRES_PER_NM = 1852;

/** Half a hull's length in nautical miles, which is its separation radius. */
export function hullRadiusNm(type: BoatType): number {
  return HULL_LENGTH_M[type] / 2 / METRES_PER_NM;
}

export const SAFETY_MARGIN_NM = SAFETY_MARGIN_M / METRES_PER_NM;
