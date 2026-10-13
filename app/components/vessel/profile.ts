import { TEMPEST_SPEC, TYPHOON_SPEC } from "./spec.ts";
import {
  chineHeight,
  deckHalfBeam,
  deckWidth,
  demiWidth,
  DECK_BOW_STATION,
  DECK_STERN_STATION,
  hullSpacing,
  keelDepth,
  TUMBLEHOME,
  type VesselSpec,
} from "./spec.ts";

// THE SIDE ELEVATION
//
// Generated from the same spec the Three.js model is built from, so the drawing
// cannot drift from the hull the chart and the helm show. Everything here is in
// metres, with +y forward and +z up; the component maps that onto the viewBox.

export interface ProfilePart {
  id: string;
  d: string;
  /** Outline parts carry the eye; construction lines stay quiet. */
  weight: "outline" | "detail" | "construction";
}

export interface ProfileDrawing {
  parts: ProfilePart[];
  /** Metres, in model space. */
  bounds: { minY: number; maxY: number; minZ: number; maxZ: number };
  dimensions: {
    lengthM: number;
    beamM: number;
    draftM: number;
    deckM: number;
    heightM: number;
  };
}

const STATIONS = 72;

function stationY(spec: VesselSpec, t: number): number {
  return -spec.lengthM / 2 + t * spec.lengthM;
}

function deckTopOf(spec: VesselSpec): number {
  return spec.deckM - 0.02 * (spec.lengthM / 3.9);
}

function polyline(points: readonly (readonly [number, number])[], close = false): string {
  const body = points
    .map(([y, z], index) => `${index === 0 ? "M" : "L"}${y.toFixed(4)} ${z.toFixed(4)}`)
    .join(" ");
  return close ? `${body} Z` : body;
}

export function buildProfile(spec: VesselSpec): ProfileDrawing {
  const scale = spec.lengthM / 3.9;
  const deckTop = deckTopOf(spec);
  const parts: ProfilePart[] = [];

  const keel: [number, number][] = [];
  const chine: [number, number][] = [];
  const sheer: [number, number][] = [];

  for (let i = 0; i <= STATIONS; i += 1) {
    const t = i / STATIONS;
    const y = stationY(spec, t);
    keel.push([y, -spec.draftM * keelDepth(t)]);
    chine.push([y, spec.deckM * chineHeight(t)]);
    sheer.push([y, deckTop]);
  }

  // The demi-hull silhouette: along the keel to the stem, up, and back along
  // the top. Seen from the side the two hulls coincide, so one outline is the
  // whole hull form.
  parts.push({
    id: "hull",
    weight: "outline",
    d: polyline([...keel, ...[...sheer].reverse()], true),
  });

  parts.push({ id: "chine", weight: "detail", d: polyline(chine) });

  // The deck, standing proud of the hull tops and stopping short of the stem.
  const deckAft = stationY(spec, DECK_STERN_STATION);
  const deckFwd = stationY(spec, DECK_BOW_STATION);
  const deckThickness = 0.05 * scale;
  parts.push({
    id: "deck",
    weight: "outline",
    d: polyline([
      [deckAft, spec.deckM - deckThickness],
      [deckFwd, spec.deckM - deckThickness],
      [deckFwd, spec.deckM],
      [deckAft, spec.deckM],
    ], true),
  });

  // Stern beam and the drive hanging under it.
  const sternY = -spec.lengthM / 2;
  const beamHeight = spec.deckM * 0.78 * 0.72;
  parts.push({
    id: "stern-beam",
    weight: "detail",
    d: polyline([
      [sternY + 0.03 * scale, spec.deckM - deckThickness],
      [sternY + 0.21 * scale, spec.deckM - deckThickness],
      [sternY + 0.21 * scale, spec.deckM - deckThickness - beamHeight],
      [sternY + 0.03 * scale, spec.deckM - deckThickness - beamHeight],
    ], true),
  });

  parts.push({
    id: "drive",
    weight: "detail",
    d: polyline([
      [sternY - 0.06 * scale, -spec.draftM * 0.25],
      [sternY + 0.14 * scale, -spec.draftM * 0.25],
      [sternY + 0.14 * scale, -spec.draftM * 1.05],
      [sternY - 0.36 * scale, -spec.draftM * 1.05],
      [sternY - 0.36 * scale, -spec.draftM * 0.8],
      [sternY - 0.06 * scale, -spec.draftM * 0.8],
    ], true),
  });

  let heightM = spec.deckM;

  if (spec.tower) {
    const { station, heightM: towerHeight, podRadiusM, armM } = spec.tower;
    const y = stationY(spec, station);
    const base = spec.deckM + 0.03 * scale;
    const top = base + towerHeight;
    heightM = top + podRadiusM * 2;

    parts.push({
      id: "tower-housing",
      weight: "detail",
      d: polyline([
        [y - 0.1 * scale, base],
        [y + 0.1 * scale, base],
        [y + 0.07 * scale, base + 0.21 * scale],
        [y - 0.07 * scale, base + 0.21 * scale],
      ], true),
    });

    parts.push({
      id: "tower-mast",
      weight: "outline",
      d: polyline([
        [y - 0.03 * scale, base + 0.2 * scale],
        [y + 0.03 * scale, base + 0.2 * scale],
        [y + 0.022 * scale, top],
        [y - 0.022 * scale, top],
      ], true),
    });

    parts.push({
      id: "tower-arm",
      weight: "detail",
      d: polyline([[y - armM, top - 0.26 * scale], [y + armM, top - 0.26 * scale]]),
    });

    parts.push({
      id: "sensor-pod",
      weight: "outline",
      d: polyline([
        [y - podRadiusM, top - podRadiusM * 0.95],
        [y + podRadiusM, top - podRadiusM * 0.95],
        [y + podRadiusM, top + podRadiusM * 0.95],
        [y - podRadiusM, top + podRadiusM * 0.95],
      ], true),
    });
  }

  // Construction: the waterline it floats on and a station grid every tenth.
  parts.push({
    id: "waterline",
    weight: "construction",
    d: polyline([[-spec.lengthM * 0.56, 0], [spec.lengthM * 0.56, 0]]),
  });

  for (let i = 0; i <= 10; i += 1) {
    const y = stationY(spec, i / 10);
    parts.push({
      id: `station-${i}`,
      weight: "construction",
      d: polyline([[y, -spec.draftM * 1.25], [y, heightM * 1.04]]),
    });
  }

  return {
    parts,
    bounds: {
      minY: -spec.lengthM * 0.58,
      maxY: spec.lengthM * 0.58,
      minZ: -spec.draftM * 1.35,
      maxZ: heightM * 1.1,
    },
    dimensions: {
      lengthM: spec.lengthM,
      beamM: spec.beamM,
      draftM: spec.draftM,
      deckM: spec.deckM,
      heightM,
    },
  };
}

/**
 * The two edges of one demi-hull at a station, measured from the centreline.
 *
 * Both are needed, not just the outer: a catamaran plan that draws only the
 * outside reads as one wide hull, and the tunnel between the demis is the whole
 * point of the form.
 */
export function planHalfBeam(
  spec: VesselSpec,
  t: number,
): { outer: number; inner: number; deck: number } {
  const offset = hullSpacing(spec) / 2;
  const half = (spec.demiBeamM / 2) * demiWidth(t);

  return {
    outer: offset + half,
    inner: Math.max(offset - half, 0),
    deck: offset + half * TUMBLEHOME,
  };
}

/** One demi-hull in plan: out along the outboard edge, back along the inboard. */
export function demiPlanOutline(spec: VesselSpec, samples = 48): string {
  const outboard: string[] = [];
  const inboard: string[] = [];

  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const y = stationY(spec, t);
    const { outer, inner } = planHalfBeam(spec, t);
    outboard.push(`${i === 0 ? "M" : "L"}${y.toFixed(3)} ${outer.toFixed(3)}`);
    inboard.unshift(`L${y.toFixed(3)} ${inner.toFixed(3)}`);
  }

  return `${outboard.join(" ")} ${inboard.join(" ")} Z`;
}

/** The deck in plan, stopping short of the stems so the bows stand proud. */
export function deckPlanOutline(spec: VesselSpec, samples = 36): string {
  const halfBeam = deckHalfBeam(spec);
  const starboard: string[] = [];
  const port: string[] = [];

  for (let i = 0; i <= samples; i += 1) {
    const along = i / samples;
    const t = DECK_STERN_STATION + along * (DECK_BOW_STATION - DECK_STERN_STATION);
    const y = stationY(spec, t);
    const x = deckWidth(along) * halfBeam;
    starboard.push(`${i === 0 ? "M" : "L"}${y.toFixed(3)} ${x.toFixed(3)}`);
    port.unshift(`L${y.toFixed(3)} ${(-x).toFixed(3)}`);
  }

  return `${starboard.join(" ")} ${port.join(" ")} Z`;
}

export function deckBeam(spec: VesselSpec): number {
  return deckHalfBeam(spec) * 2;
}


/**
 * One frame for the whole family, so the two drawings share a scale.
 *
 * Drawn to fit their own cards the classes come out the same length on the
 * page, which is the one thing a comparison drawing must not do: a Tempest is
 * nearly twice a Typhoon and the picture has to say so.
 */
export function familyFrame(): { minY: number; maxY: number; minZ: number; maxZ: number } {
  const specs = [TYPHOON_SPEC, TEMPEST_SPEC];
  const frames = specs.map(buildProfile);

  return {
    minY: Math.min(...frames.map((frame) => frame.bounds.minY)),
    maxY: Math.max(...frames.map((frame) => frame.bounds.maxY)),
    minZ: Math.min(...frames.map((frame) => frame.bounds.minZ)),
    maxZ: Math.max(...frames.map((frame) => frame.bounds.maxZ)),
  };
}
