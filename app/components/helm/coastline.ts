import * as THREE from "three";
import { elevationAt } from "./terrain.ts";

// THE SHORE, IN THE BOAT'S OWN FRAME
//
// The helm looks at real land. Heights come from the baked Mapbox Terrain-RGB
// grid, sampled on a polar mesh centred on the boat, so what rises on the
// horizon is the shore actually in that bearing at that range.
//
// Polar rather than square because the eye needs resolution near the boat and
// almost none at twelve kilometres: rings are spaced by the square of their
// index, which puts most of the detail in the first mile.

const RADIUS_M = 14000;
const RINGS = 30;
const SPOKES = 120;
const METRES_PER_DEGREE_LAT = 110574;

export interface CoastlineMesh {
  group: THREE.Group;
  dispose: () => void;
}

/**
 * Build the surrounding shore as a mesh in the boat's local frame: +X
 * starboard, +Y bow, +Z up, metres. Returns an empty group when there is no
 * land within range, so an open-water station costs nothing.
 */
export function buildCoastline(
  origin: { latitude: number; longitude: number },
  headingDegrees: number,
): CoastlineMesh {
  const group = new THREE.Group();
  const metresPerDegreeLon = METRES_PER_DEGREE_LAT
    * Math.cos((origin.latitude * Math.PI) / 180);

  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  let highest = 0;

  for (let ring = 0; ring <= RINGS; ring += 1) {
    const distance = RADIUS_M * (ring / RINGS) ** 2;

    for (let spoke = 0; spoke < SPOKES; spoke += 1) {
      const worldBearing = (spoke / SPOKES) * 360;
      const worldRadians = (worldBearing * Math.PI) / 180;
      const latitude = origin.latitude
        + (Math.cos(worldRadians) * distance) / METRES_PER_DEGREE_LAT;
      const longitude = origin.longitude
        + (Math.sin(worldRadians) * distance) / metresPerDegreeLon;

      const elevation = elevationAt(latitude, longitude);
      highest = Math.max(highest, elevation);

      // Local bearing: the hull's bow is +Y, so the world bearing is turned
      // back by the heading the boat is making.
      const localRadians = ((worldBearing - headingDegrees) * Math.PI) / 180;
      positions.push(
        Math.sin(localRadians) * distance,
        Math.cos(localRadians) * distance,
        // Sit the shoreline a touch under the waterline so the sea plane keeps
        // a clean edge instead of z-fighting a zero-height rim.
        elevation > 0 ? elevation : -2,
      );

      // Low ground reads cool and dark and ridges lift toward a dusty grey, then
      // the whole thing fades toward the sky with range. That fade is aerial
      // perspective, and without it a headland twelve kilometres off is the
      // same ink as the beach alongside the hull and the horizon reads flat.
      const lift = Math.min(elevation / 220, 1);
      const haze = (distance / RADIUS_M) ** 0.6 * 0.72;
      const red = 0.1 + lift * 0.34;
      const green = 0.13 + lift * 0.33;
      const blue = 0.16 + lift * 0.3;
      colours.push(
        red * (1 - haze) + 0.17 * haze,
        green * (1 - haze) + 0.25 * haze,
        blue * (1 - haze) + 0.32 * haze,
      );
    }
  }

  if (highest <= 0) {
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
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    // The near scene's fog is tuned for a few hundred metres; the shore is
    // kilometres out and would be erased by it.
    fog: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -2;
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
