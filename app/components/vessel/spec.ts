import type { BoatType } from "../../core/types";
import { HULL_LENGTH_M } from "../../core/hull.ts";
import type { Vec2 } from "./kit";

// THE VESSEL FAMILY, AS NUMBERS
//
// Both classes are the same boat: a wave-piercing catamaran with two slender
// demi-hulls under one flush payload deck, black below the chine and white
// above it. The Typhoon carries a sensor tower amidships; the Tempest is bare
// deck. Everything else differs only by scale.
//
// This file is the single source of truth for that shape. The Three.js model
// and the side-elevation drawing are both generated from it, so the diagram
// cannot drift from the hull the chart and the helm draw.

export interface TowerSpec {
  /** Where the mast stands, as a fraction of length from the transom. */
  station: number;
  heightM: number;
  /** Radius of the sensor pod on top. */
  podRadiusM: number;
  /** Half-span of the cross-arm carrying the antennas. */
  armM: number;
}

export interface VesselSpec {
  type: BoatType;
  lengthM: number;
  /** Overall beam, outboard face to outboard face. */
  beamM: number;
  /** Width of one demi-hull at its widest. */
  demiBeamM: number;
  /** Depth of the demi-hull below the waterline. */
  draftM: number;
  /** Height of the deck above the waterline. */
  deckM: number;
  tower: TowerSpec | null;
}

export const TYPHOON_SPEC: VesselSpec = {
  type: "TYPHOON",
  lengthM: HULL_LENGTH_M.TYPHOON,
  beamM: 1.55,
  demiBeamM: 0.46,
  draftM: 0.26,
  deckM: 0.44,
  // The tower the reference carries: a slender pole with a sensor pod, a
  // cross-arm and a flag staff, stepped just aft of amidships.
  tower: { station: 0.42, heightM: 1.5, podRadiusM: 0.075, armM: 0.2 },
};

export const TEMPEST_SPEC: VesselSpec = {
  type: "TEMPEST",
  lengthM: HULL_LENGTH_M.TEMPEST,
  beamM: 2.45,
  demiBeamM: 0.74,
  draftM: 0.42,
  deckM: 0.68,
  // Flat: the whole deck is payload, with nothing standing on it.
  tower: null,
};

export function specFor(type: BoatType): VesselSpec {
  return type === "TEMPEST" ? TEMPEST_SPEC : TYPHOON_SPEC;
}

/** Centre-to-centre separation of the two demi-hulls. */
export function hullSpacing(spec: VesselSpec): number {
  return spec.beamM - spec.demiBeamM;
}

// -- the demi-hull's shape, as curves in t (0 at the transom, 1 at the bow) ---

function curveOf(stops: readonly Vec2[]): (t: number) => number {
  return (t: number) => {
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (t <= first[0]) return first[1];
    if (t >= last[0]) return last[1];

    for (let index = 1; index < stops.length; index += 1) {
      const [t0, v0] = stops[index - 1];
      const [t1, v1] = stops[index];
      if (t > t1) continue;
      const u = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * (u * u * (3 - 2 * u));
    }

    return last[1];
  };
}

/** Half-width of one demi-hull, as a fraction of its widest. */
export const demiWidth = curveOf([
  [0, 0.92], [0.22, 1], [0.55, 0.95], [0.76, 0.72], [0.9, 0.34], [0.97, 0.12], [1, 0.015],
]);

/**
 * Keel line, as a fraction of draft below the waterline. A wave-piercer keeps
 * its forefoot deep and lifts only at the very stem, which is what makes the
 * bow look like a blade rather than a wedge.
 */
export const keelDepth = curveOf([
  [0, 0.94], [0.45, 1], [0.84, 0.94], [0.95, 0.72], [1, 0.32],
]);

/** Height of the chine above the waterline, as a fraction of deck height. */
export const chineHeight = curveOf([
  [0, 0.1], [0.5, 0.14], [0.82, 0.26], [1, 0.5],
]);

/**
 * How far the topsides tumble in between the chine and the deck. The reference
 * has a pronounced lean, which is what leaves the chine visible outboard of the
 * deck edge and stops the deck reading as a slab laid over a box.
 */
export const TUMBLEHOME = 0.72;

/**
 * The deck stops short of the stem, so the two bows stand out ahead of it. That
 * overhang is the most recognisable thing about the hull form.
 */
export const DECK_BOW_STATION = 0.93;
export const DECK_STERN_STATION = 0.012;

/** Plan half-width of the deck, as a fraction of its own maximum half-beam. */
export const deckWidth = curveOf([
  [0, 0.97], [0.18, 1], [0.62, 0.99], [0.8, 0.93], [0.9, 0.74], [1, 0.3],
]);

/** Half-beam of the deck: it lands on the tops of the two demi-hulls. */
export function deckHalfBeam(spec: VesselSpec): number {
  return hullSpacing(spec) / 2 + (spec.demiBeamM / 2) * TUMBLEHOME;
}
