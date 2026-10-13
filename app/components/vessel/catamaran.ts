import * as THREE from "three";
import {
  box,
  domeZ,
  latheZ,
  loftBand,
  mix,
  PartBin,
  plate,
  ringZ,
  stationCap,
  sweep,
  tubeZ,
  type HullSpec,
  type Vec2,
  type Vec3,
} from "./kit";
import {
  chineHeight,
  deckHalfBeam,
  deckWidth,
  DECK_BOW_STATION,
  DECK_STERN_STATION,
  demiWidth,
  hullSpacing,
  keelDepth,
  TUMBLEHOME,
  type VesselSpec,
} from "./spec.ts";

// THE CATAMARAN
//
// One builder for the whole family. Two slender demi-hulls, black below the
// chine and white above it, carrying a flush deck that is almost the entire
// vessel. Nothing stands on that deck except the tower, and only one class has
// one — which is the only difference between a Typhoon and a Tempest.

const DEMI_STATIONS = 44;

/**
 * One demi-hull's half-section, about its own centreline, from the keel up and
 * over to the centreline again.
 *
 * The last point is on the centreline, which is what closes the top. Without it
 * the hull is an open shell: you see straight through the deck into the inside
 * of the far side, and the whole boat reads as bent sheet metal rather than a
 * solid.
 */
function demiSection(spec: VesselSpec) {
  const deckTop = spec.deckM - 0.02 * (spec.lengthM / 3.9);

  return (t: number): readonly Vec2[] => {
    const halfWidth = (spec.demiBeamM / 2) * demiWidth(t);
    const keelZ = -spec.draftM * keelDepth(t);
    const chineZ = spec.deckM * chineHeight(t);

    return [
      [0, keelZ],
      [halfWidth * 0.62, mix(keelZ, chineZ, 0.55)],
      [halfWidth, chineZ],
      [halfWidth * mix(1, TUMBLEHOME, 0.5), mix(chineZ, deckTop, 0.55)],
      [halfWidth * TUMBLEHOME, deckTop],
      [0, deckTop],
    ];
  };
}

/** Index of the point on the centreline that closes the deck of a demi-hull. */
const DEMI_TOP = 5;

/**
 * The deck outline in plan, starboard edge forward then port edge back. It runs
 * between the stern and bow stations rather than the full length, which is what
 * leaves the two bows standing proud of it.
 */
function deckOutline(spec: VesselSpec, inset: number): Vec2[] {
  const halfBeam = deckHalfBeam(spec) - inset;
  const points: Vec2[] = [];
  const samples = 26;

  const station = (i: number) => mix(DECK_STERN_STATION, DECK_BOW_STATION, i / samples);
  const edge = (i: number): Vec2 => {
    const t = station(i);
    const along = (t - DECK_STERN_STATION) / (DECK_BOW_STATION - DECK_STERN_STATION);
    return [deckWidth(along) * halfBeam, -spec.lengthM / 2 + t * spec.lengthM];
  };

  for (let i = 0; i <= samples; i += 1) points.push(edge(i));
  for (let i = samples; i >= 0; i -= 1) {
    const [x, y] = edge(i);
    points.push([-x, y]);
  }

  return points;
}

function deckGeometry(spec: VesselSpec, inset: number, thickness: number): THREE.BufferGeometry {
  const outline = deckOutline(spec, inset);
  const shape = new THREE.Shape();
  shape.moveTo(outline[0][0], outline[0][1]);
  for (const [x, y] of outline.slice(1)) shape.lineTo(x, y);
  shape.closePath();

  return new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 2,
  });
}

function demiHulls(bin: PartBin, spec: VesselSpec): void {
  const hull: HullSpec = {
    length: spec.lengthM,
    stations: DEMI_STATIONS,
    section: demiSection(spec),
  };
  const offset = hullSpacing(spec) / 2;

  for (const side of [1, -1] as const) {
    const place = { position: [side * offset, 0, 0] as Vec3 };
    // Black below the chine, white above it: the split the reference makes.
    bin.add("hullDark", loftBand(hull, 0, 2), place);
    bin.add("trunk", loftBand(hull, 2, 4), place);
    // The flat top of the demi-hull, closing it onto its own centreline.
    bin.add("trunk", loftBand(hull, 4, DEMI_TOP), place);
    // Both ends capped, so the solid is genuinely closed rather than a shell
    // that happens to be hidden from the usual camera angles.
    bin.add("trunk", stationCap(hull, 0, DEMI_TOP, false), place);
    bin.add("trunk", stationCap(hull, 1, DEMI_TOP, true), place);
  }
}

function deck(bin: PartBin, spec: VesselSpec): void {
  const scale = spec.lengthM / 3.9;
  const thickness = 0.05 * scale;
  const deckZ = spec.deckM;

  // The deck panel sits inside a raised rim, which is what gives the reference
  // its tray-like look rather than a slab with painted edges.
  bin.add("trunk", deckGeometry(spec, 0, thickness), { position: [0, 0, deckZ - thickness] });
  bin.add("nonSkid", deckGeometry(spec, 0.07 * scale, thickness * 0.5), {
    position: [0, 0, deckZ],
  });

  // Rub rail round the deck edge.
  const rail: Vec3[] = deckOutline(spec, 0.01 * scale)
    .filter((_, index) => index % 2 === 0)
    .map(([x, y]) => [x, y, deckZ + thickness * 0.2]);
  rail.push(rail[0]);
  bin.add("rubber", sweep(rail, 0.028 * scale, 6));

  // A flush hatch forward and a pair of lifting points, the only things
  // breaking the deck on either class.
  bin.add("deck", plate(0.42 * scale, 0.42 * scale, 0.012 * scale, 0.05 * scale), {
    position: [0, spec.lengthM * 0.26, deckZ + thickness * 0.5],
  });

  for (const side of [1, -1] as const) {
    for (const station of [-0.3, 0.1]) {
      bin.add("steel", ringZ(0.045 * scale, 0.012 * scale, 10), {
        position: [
          side * (deckHalfBeam(spec) - 0.14 * scale),
          spec.lengthM * station,
          deckZ + thickness * 0.6,
        ],
        rotation: [Math.PI / 2, 0, 0],
      });
    }
  }
}

/** The black beam across the stern that ties the hulls together and carries the drives. */
function sternBeam(bin: PartBin, spec: VesselSpec): void {
  const scale = spec.lengthM / 3.9;
  const sternY = -spec.lengthM / 2;
  const beamHeight = spec.deckM * 0.78;
  const offset = hullSpacing(spec) / 2;

  bin.add("hullDark", box(deckHalfBeam(spec) * 1.92, 0.18 * scale, beamHeight * 0.72), {
    position: [0, sternY + 0.12 * scale, spec.deckM - beamHeight * 0.44],
  });
  bin.add("composite", box(deckHalfBeam(spec) * 1.6, 0.08 * scale, beamHeight * 0.3), {
    position: [0, sternY + 0.01 * scale, spec.deckM - beamHeight * 0.52],
  });

  for (const side of [1, -1] as const) {
    // Drive leg and propeller under each demi-hull.
    bin.add("composite", box(0.13 * scale, 0.2 * scale, 0.5 * scale), {
      position: [side * offset, sternY + 0.04 * scale, -spec.draftM * 0.5],
    });
    bin.add("composite", latheZ([
      [0, 0.3 * scale],
      [0.1 * scale, 0.22 * scale],
      [0.12 * scale, -0.22 * scale],
      [0.05 * scale, -0.3 * scale],
      [0, -0.3 * scale],
    ], 14), {
      position: [side * offset, sternY - 0.06 * scale, -spec.draftM * 0.92],
      rotation: [Math.PI / 2, 0, 0],
    });
    bin.add("brightMetal", tubeZ(0.05 * scale, 0.035 * scale, 0.1 * scale, 10), {
      position: [side * offset, sternY - 0.3 * scale, -spec.draftM * 0.92],
      rotation: [Math.PI / 2, 0, 0],
    });
    bin.add("accent", ringZ(0.07 * scale, 0.012 * scale, 12), {
      position: [side * offset * 1.3, sternY + 0.02 * scale, spec.deckM - beamHeight * 0.5],
      rotation: [Math.PI / 2, 0, 0],
    });
  }
}

/** The sensor tower: the Typhoon's only superstructure. */
function tower(bin: PartBin, spec: VesselSpec): void {
  if (!spec.tower) return;

  const { station, heightM, podRadiusM, armM } = spec.tower;
  const scale = spec.lengthM / 3.9;
  const y = -spec.lengthM / 2 + station * spec.lengthM;
  const base = spec.deckM + 0.03 * scale;

  // A white cylindrical housing at the foot, as in the reference.
  bin.add("trunk", latheZ([
    [0.1 * scale, 0],
    [0.095 * scale, 0.16 * scale],
    [0.06 * scale, 0.21 * scale],
    [0, 0.21 * scale],
  ], 16), { position: [0, y, base] });

  const mastFoot = base + 0.2 * scale;
  const mastTop = base + heightM;
  bin.add("steel", tubeZ(0.022 * scale, 0.032 * scale, heightM - 0.2 * scale, 10), {
    position: [0, y, (mastFoot + mastTop) / 2],
  });

  // Cross-arm and whip antennas.
  bin.add("steel", tubeZ(0.012 * scale, 0.012 * scale, armM * 2, 8), {
    position: [0, y, mastTop - 0.26 * scale],
    rotation: [0, Math.PI / 2, 0],
  });
  for (const side of [1, -1] as const) {
    bin.add("steel", tubeZ(0.008 * scale, 0.012 * scale, 0.3 * scale, 6), {
      position: [side * armM, y, mastTop - 0.1 * scale],
    });
  }

  // Sensor pod on top, with its window facing forward.
  bin.add("composite", tubeZ(podRadiusM, podRadiusM, podRadiusM * 1.9, 16), {
    position: [0, y, mastTop],
  });
  bin.add("dome", domeZ(podRadiusM, Math.PI / 2, 16), {
    position: [0, y, mastTop + podRadiusM * 0.95],
  });
  bin.add("optic", tubeZ(podRadiusM * 0.52, podRadiusM * 0.52, 0.02 * scale, 14), {
    position: [0, y + podRadiusM, mastTop],
    rotation: [Math.PI / 2, 0, 0],
  });
  bin.add("accent", ringZ(podRadiusM * 0.62, 0.008 * scale, 14), {
    position: [0, y + podRadiusM * 0.98, mastTop],
    rotation: [Math.PI / 2, 0, 0],
  });
}

export function buildCatamaran(spec: VesselSpec, selected: boolean): THREE.Group {
  const bin = new PartBin();
  demiHulls(bin, spec);
  deck(bin, spec);
  sternBeam(bin, spec);
  tower(bin, spec);
  return bin.build(selected);
}
