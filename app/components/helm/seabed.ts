import * as THREE from "three";
import type { DepthField } from "./bathymetry.ts";

// THE BOTTOM, IN THE BOAT'S OWN FRAME
//
// The chart shades depth and the helm did not, so taking a boat meant going
// from "there is four metres under you here and twenty over there" to a flat
// plane of water with no bottom at all. This is the same depth the chart reads,
// decoded from the Open Waters DEM and laid under the hull.
//
// Polar for the same reason the shore is: the eye needs resolution within a few
// hundred metres and almost none at two kilometres, so rings are spaced by the
// square of their index.

const RADIUS_M = 2600;
const RINGS = 34;
const SPOKES = 108;
const METRES_PER_DEGREE_LAT = 110574;

/**
 * How deep the bottom is allowed to be drawn.
 *
 * Depth is drawn at true scale, which is the point of drawing it. Past this the
 * water is opaque from any eye height a boat has, and a basin that really is
 * five hundred metres down would drop the mesh out of the scene and read as a
 * hole in the world rather than as deep water. Beyond the limit the bottom is
 * held flat and the colour keeps reporting the true depth.
 */
const VISIBLE_DEPTH_M = 45;

/** Shallow to deep, matching the ramp the chart paints depth areas with. */
const DEPTH_RAMP = {
  DARK: [
    { depth: 0, colour: [0.21, 0.52, 0.64] },
    { depth: 5, colour: [0.15, 0.40, 0.51] },
    { depth: 12, colour: [0.11, 0.30, 0.39] },
    { depth: 25, colour: [0.08, 0.22, 0.29] },
    { depth: 60, colour: [0.06, 0.16, 0.21] },
  ],
  // Not the chart's ramp. On paper, shallow water is almost white and the
  // page carries the contrast; from a boat in daylight, shallow water is pale
  // green-blue and deep water is blue, and a near-white sea read as a white-out
  // with no bottom, no depth and barely a grid.
  LIGHT: [
    { depth: 0, colour: [0.62, 0.76, 0.76] },
    { depth: 5, colour: [0.49, 0.67, 0.73] },
    { depth: 12, colour: [0.37, 0.57, 0.69] },
    { depth: 25, colour: [0.27, 0.46, 0.62] },
    { depth: 60, colour: [0.19, 0.37, 0.54] },
  ],
} as const;

function rampAt(theme: "DARK" | "LIGHT", depth: number): readonly [number, number, number] {
  const stops = DEPTH_RAMP[theme];

  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1];
    const next = stops[index];
    if (depth > next.depth) continue;

    const span = next.depth - previous.depth;
    const ratio = span === 0 ? 0 : (depth - previous.depth) / span;
    return [
      previous.colour[0] + (next.colour[0] - previous.colour[0]) * ratio,
      previous.colour[1] + (next.colour[1] - previous.colour[1]) * ratio,
      previous.colour[2] + (next.colour[2] - previous.colour[2]) * ratio,
    ];
  }

  const last = stops[stops.length - 1].colour;
  return [last[0], last[1], last[2]];
}

export interface SeabedMesh {
  group: THREE.Group;
  dispose: () => void;
}

/**
 * Build the bottom around a position, in the boat's local frame: +X starboard,
 * +Y bow, +Z up, metres. Returns an empty group when no tile has arrived, so a
 * helm opened offline costs nothing and simply has no bottom.
 */
export function buildSeabed(
  origin: { latitude: number; longitude: number },
  headingDegrees: number,
  field: DepthField,
  theme: "DARK" | "LIGHT",
): SeabedMesh {
  const group = new THREE.Group();

  if (!field.ready()) {
    return { group, dispose: () => group.clear() };
  }

  const metresPerDegreeLon = METRES_PER_DEGREE_LAT
    * Math.cos((origin.latitude * Math.PI) / 180);

  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  let deepest = 0;

  for (let ring = 0; ring <= RINGS; ring += 1) {
    const distance = RADIUS_M * (ring / RINGS) ** 2;

    for (let spoke = 0; spoke < SPOKES; spoke += 1) {
      const worldBearing = (spoke / SPOKES) * 360;
      const worldRadians = (worldBearing * Math.PI) / 180;
      const latitude = origin.latitude
        + (Math.cos(worldRadians) * distance) / METRES_PER_DEGREE_LAT;
      const longitude = origin.longitude
        + (Math.sin(worldRadians) * distance) / metresPerDegreeLon;

      const depth = field.depthAt(latitude, longitude);
      deepest = Math.max(deepest, depth);

      const localRadians = ((worldBearing - headingDegrees) * Math.PI) / 180;
      positions.push(
        Math.sin(localRadians) * distance,
        Math.cos(localRadians) * distance,
        -Math.min(depth, VISIBLE_DEPTH_M),
      );

      const [red, green, blue] = rampAt(theme, depth);
      // The bottom fades out with range rather than ending at a rim: water
      // this far off is haze, and a hard edge at two kilometres would read as
      // the sea stopping.
      const fade = 1 - Math.min(1, (distance / RADIUS_M) ** 1.5);
      // Dry ground has no depth to report and must not be painted as shallows;
      // the shore mesh already owns everything above the waterline.
      const alpha = depth <= 0 ? 0 : fade;
      colours.push(red, green, blue, alpha);
    }
  }

  if (deepest <= 0) {
    return { group, dispose: () => group.clear() };
  }

  for (let ring = 0; ring < RINGS; ring += 1) {
    for (let spoke = 0; spoke < SPOKES; spoke += 1) {
      const next = (spoke + 1) % SPOKES;
      const a = ring * SPOKES + spoke;
      const b = ring * SPOKES + next;
      const c = (ring + 1) * SPOKES + spoke;
      const d = (ring + 1) * SPOKES + next;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  // Four components: the fourth is alpha, which is what lets the bottom dissolve
  // into the distance and disappear under dry land.
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 4));
  geometry.setIndex(indices);

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  // Under the water, and under the grid drawn on it.
  mesh.renderOrder = -3;
  mesh.frustumCulled = false;
  group.add(mesh);

  return {
    group,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      group.clear();
    },
  };
}
