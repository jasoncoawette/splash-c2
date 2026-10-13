import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { vesselMaterials, type ToneKey } from "./palette";

// GEOMETRY KIT
//
// Model space for every vessel:
//   +X starboard, +Y bow, +Z up, origin on the waterline amidships.
//   One world unit is one metre of real boat.
//
// Every part is a solid. Parts are collected into a PartBin and merged per tone,
// so a hundred-part vessel costs about a dozen draw calls.

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export interface Placement {
  position?: Vec3;
  rotation?: Vec3;
  quaternion?: THREE.Quaternion;
  scale?: Vec3 | number;
  mirrorX?: boolean;
}

// -- curves -------------------------------------------------------------------

/** Smoothstep interpolation through [t, value] stops. Keeps hull lines fair. */
export function curve(stops: readonly Vec2[], t: number): number {
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
}

export function mix(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

// -- surfaces -----------------------------------------------------------------

/**
 * Build an indexed grid from rows of points.
 * Winding is chosen so the face normal is cross(rowStep, columnStep): the caller
 * orders the columns to decide which way the surface faces.
 */
export function gridGeometry(rows: readonly (readonly Vec3[])[]): THREE.BufferGeometry {
  const rowCount = rows.length;
  const columnCount = rows[0].length;
  const positions = new Float32Array(rowCount * columnCount * 3);
  const uvs = new Float32Array(rowCount * columnCount * 2);
  const indices: number[] = [];

  for (let i = 0; i < rowCount; i += 1) {
    for (let k = 0; k < columnCount; k += 1) {
      const point = rows[i][k];
      const offset = (i * columnCount + k) * 3;
      positions[offset] = point[0];
      positions[offset + 1] = point[1];
      positions[offset + 2] = point[2];
      const uvOffset = (i * columnCount + k) * 2;
      uvs[uvOffset] = columnCount > 1 ? k / (columnCount - 1) : 0;
      uvs[uvOffset + 1] = rowCount > 1 ? i / (rowCount - 1) : 0;
    }
  }

  for (let i = 0; i < rowCount - 1; i += 1) {
    for (let k = 0; k < columnCount - 1; k += 1) {
      const a = i * columnCount + k;
      const b = (i + 1) * columnCount + k;
      const c = i * columnCount + k + 1;
      const d = (i + 1) * columnCount + k + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export interface HullSpec {
  /** Stern at t = 0, bow at t = 1. */
  readonly length: number;
  readonly stations: number;
  /** Half-section from the keel outward: x >= 0, z up. */
  readonly section: (t: number) => readonly Vec2[];
}

function stationY(spec: HullSpec, t: number): number {
  return -spec.length / 2 + t * spec.length;
}

/**
 * Loft one band of the hull between two indices of the half-section, built as a
 * separate strip per side. Lofting bands separately gives a hard crease at the
 * chine and at the keel instead of a smeared one, which is what a planing hull
 * actually looks like.
 */
export function loftBand(
  spec: HullSpec,
  fromIndex: number,
  toIndex: number,
): THREE.BufferGeometry {
  const sides: THREE.BufferGeometry[] = [];

  for (const side of [1, -1] as const) {
    const rows: Vec3[][] = [];

    for (let i = 0; i <= spec.stations; i += 1) {
      const t = i / spec.stations;
      const y = stationY(spec, t);
      const half = spec.section(t);
      const row: Vec3[] = [];

      // Starboard columns run outward, port columns inward, so both strips
      // end up facing away from the centreline.
      if (side === 1) {
        for (let k = fromIndex; k <= toIndex; k += 1) row.push([half[k][0], y, half[k][1]]);
      } else {
        for (let k = toIndex; k >= fromIndex; k -= 1) row.push([-half[k][0], y, half[k][1]]);
      }

      rows.push(row);
    }

    sides.push(gridGeometry(rows));
  }

  const merged = mergeGeometries(sides, false);
  for (const side of sides) side.dispose();
  if (!merged) throw new Error("Failed to loft hull band");
  return merged;
}

/** Flat cap closing the hull at one station, facing aft (-Y) or forward (+Y). */
export function stationCap(
  spec: HullSpec,
  t: number,
  toIndex: number,
  facingForward: boolean,
): THREE.BufferGeometry {
  const half = spec.section(t);
  const y = stationY(spec, t);
  const ring: Vec3[] = [];

  for (let k = toIndex; k > 0; k -= 1) ring.push([-half[k][0], y, half[k][1]]);
  for (let k = 0; k <= toIndex; k += 1) ring.push([half[k][0], y, half[k][1]]);

  let centreZ = 0;
  for (const point of ring) centreZ += point[2];
  centreZ /= ring.length;

  const positions: number[] = [];
  const uvs: number[] = [];

  for (let k = 0; k < ring.length - 1; k += 1) {
    const a: Vec3 = [0, y, centreZ];
    const b = facingForward ? ring[k + 1] : ring[k];
    const c = facingForward ? ring[k] : ring[k + 1];
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    uvs.push(0.5, 0.5, 0, 0, 1, 0);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

/** Deck plate spanning the sheer line, inset by `inset` metres. */
export function deckSurface(
  spec: HullSpec,
  sheerIndex: number,
  inset: number,
  drop: number,
  camber: number,
): THREE.BufferGeometry {
  const rows: Vec3[][] = [];
  const columns = 9;

  for (let i = 0; i <= spec.stations; i += 1) {
    const t = i / spec.stations;
    const y = stationY(spec, t);
    const edge = spec.section(t)[sheerIndex];
    const halfWidth = Math.max(edge[0] - inset, 0.001);
    const row: Vec3[] = [];

    // Columns run from starboard to port so the face normal points up.
    for (let k = 0; k < columns; k += 1) {
      const u = 1 - (2 * k) / (columns - 1);
      const x = u * halfWidth;
      const z = edge[1] - drop + camber * (1 - u * u);
      row.push([x, y, z]);
    }

    rows.push(row);
  }

  return gridGeometry(rows);
}

/** The sheer line as a 3D path, used for rub rails and toe rails. */
export function sheerPath(
  spec: HullSpec,
  sheerIndex: number,
  side: 1 | -1,
  fromT: number,
  toT: number,
  samples = 24,
): Vec3[] {
  const points: Vec3[] = [];

  for (let i = 0; i <= samples; i += 1) {
    const t = mix(fromT, toT, i / samples);
    const edge = spec.section(t)[sheerIndex];
    points.push([side * edge[0], stationY(spec, t), edge[1]]);
  }

  return points;
}

/** A line following one half-section index along the hull, for spray rails. */
export function hullPath(
  spec: HullSpec,
  index: number,
  side: 1 | -1,
  fromT: number,
  toT: number,
  offset: Vec3 = [0, 0, 0],
  samples = 20,
): Vec3[] {
  const points: Vec3[] = [];

  for (let i = 0; i <= samples; i += 1) {
    const t = mix(fromT, toT, i / samples);
    const edge = spec.section(t)[index];
    points.push([
      side * (edge[0] + offset[0]),
      stationY(spec, t) + offset[1],
      edge[1] + offset[2],
    ]);
  }

  return points;
}

// -- primitives ---------------------------------------------------------------

export function box(x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x, y, z);
}

/** Cylinder with its axis along +Z. */
export function tubeZ(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments = 12,
  open = false,
): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(
    radiusTop,
    radiusBottom,
    height,
    segments,
    1,
    open,
  ).rotateX(Math.PI / 2);
}

/** Lathe around the +Z axis. Profile points are [radius, height]. */
export function latheZ(profile: readonly Vec2[], segments = 16): THREE.BufferGeometry {
  const points = profile.map(([radius, height]) => new THREE.Vector2(radius, height));
  return new THREE.LatheGeometry(points, segments).rotateX(Math.PI / 2);
}

/** Dome opening downward, apex at +Z. */
export function domeZ(radius: number, sweep = Math.PI / 2, segments = 16): THREE.BufferGeometry {
  return new THREE.SphereGeometry(radius, segments, 9, 0, Math.PI * 2, 0, sweep)
    .rotateX(Math.PI / 2);
}

export function ballZ(radius: number, segments = 14): THREE.BufferGeometry {
  return new THREE.SphereGeometry(radius, segments, segments);
}

/** Torus lying flat in the XY plane. */
export function ringZ(radius: number, thickness: number, segments = 14): THREE.BufferGeometry {
  return new THREE.TorusGeometry(radius, thickness, 8, segments);
}

/** Rounded plate extruded along +Z: the shape used for hatches and cases. */
export function plate(
  width: number,
  depth: number,
  height: number,
  radius: number,
  bevel = 0.012,
): THREE.BufferGeometry {
  const halfWidth = width / 2 - radius;
  const halfDepth = depth / 2 - radius;
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth, -halfDepth - radius);
  shape.lineTo(halfWidth, -halfDepth - radius);
  shape.quadraticCurveTo(halfWidth + radius, -halfDepth - radius, halfWidth + radius, -halfDepth);
  shape.lineTo(halfWidth + radius, halfDepth);
  shape.quadraticCurveTo(halfWidth + radius, halfDepth + radius, halfWidth, halfDepth + radius);
  shape.lineTo(-halfWidth, halfDepth + radius);
  shape.quadraticCurveTo(-halfWidth - radius, halfDepth + radius, -halfWidth - radius, halfDepth);
  shape.lineTo(-halfWidth - radius, -halfDepth);
  shape.quadraticCurveTo(-halfWidth - radius, -halfDepth - radius, -halfWidth, -halfDepth - radius);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(height - bevel * 2, 0.002),
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 1,
    curveSegments: 3,
  });
  geometry.translate(0, 0, bevel);
  return geometry;
}

/** A swept tube through world points: rub rails, cable runs, grab rails. */
export function sweep(
  points: readonly Vec3[],
  radius: number,
  radialSegments = 6,
): THREE.BufferGeometry {
  const curvePath = new THREE.CatmullRomCurve3(
    points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  );
  return new THREE.TubeGeometry(
    curvePath,
    Math.max(points.length, 10),
    radius,
    radialSegments,
    false,
  );
}

// -- repeated detail ----------------------------------------------------------

export function matrixOf(place: Placement = {}): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  const rotation = place.rotation ?? [0, 0, 0];
  const quaternion = place.quaternion?.clone()
    ?? new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotation[0], rotation[1], rotation[2]),
    );

  const rawScale = place.scale ?? 1;
  const scale = typeof rawScale === "number"
    ? new THREE.Vector3(rawScale, rawScale, rawScale)
    : new THREE.Vector3(rawScale[0], rawScale[1], rawScale[2]);
  if (place.mirrorX) scale.x *= -1;

  const position = place.position ?? [0, 0, 0];
  matrix.compose(
    new THREE.Vector3(position[0], position[1], position[2]),
    quaternion,
    scale,
  );
  return matrix;
}

/**
 * The part collector. Geometries are cloned, placed and merged per tone, so a
 * dense vessel stays cheap to draw and cheap to clone per boat.
 */
export class PartBin {
  private readonly tones = new Map<ToneKey, THREE.BufferGeometry[]>();

  add(tone: ToneKey, geometry: THREE.BufferGeometry, place?: Placement): this {
    const placed = geometry.clone().applyMatrix4(matrixOf(place));
    const flat = placed.index ? placed.toNonIndexed() : placed;
    if (flat !== placed) placed.dispose();

    for (const name of Object.keys(flat.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "uv") {
        flat.deleteAttribute(name);
      }
    }

    if (!flat.getAttribute("uv")) {
      const count = flat.getAttribute("position").count;
      flat.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    }

    const list = this.tones.get(tone);
    if (list) list.push(flat);
    else this.tones.set(tone, [flat]);
    return this;
  }

  /** Place the same part at several spots: cleats, bolts, fenders, lights. */
  addEach(
    tone: ToneKey,
    geometry: THREE.BufferGeometry,
    places: readonly Placement[],
  ): this {
    for (const place of places) this.add(tone, geometry, place);
    geometry.dispose();
    return this;
  }

  /** Place a part on both sides of the centreline. */
  addPair(tone: ToneKey, geometry: THREE.BufferGeometry, place: Placement): this {
    const position = place.position ?? [0, 0, 0];
    const rotation = place.rotation ?? [0, 0, 0];
    this.add(tone, geometry, place);
    this.add(tone, geometry, {
      ...place,
      position: [-position[0], position[1], position[2]],
      rotation: [rotation[0], -rotation[1], -rotation[2]],
      mirrorX: !place.mirrorX,
    });
    return this;
  }

  build(selected: boolean): THREE.Group {
    const materials = vesselMaterials(selected);
    const group = new THREE.Group();

    for (const [tone, list] of this.tones) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) continue;
      if (list.length > 1) for (const item of list) item.dispose();

      const mesh = new THREE.Mesh(merged, materials[tone]);
      mesh.name = tone;
      mesh.userData.tone = tone;
      mesh.frustumCulled = false;
      group.add(mesh);
    }

    this.tones.clear();
    return group;
  }
}

/** Evenly spaced bolt heads around a circle, as one placement list. */
export function boltRing(
  count: number,
  radius: number,
  centre: Vec3,
  startAngle = 0,
): Placement[] {
  const places: Placement[] = [];

  for (let i = 0; i < count; i += 1) {
    const angle = startAngle + (i / count) * Math.PI * 2;
    places.push({
      position: [
        centre[0] + Math.cos(angle) * radius,
        centre[1] + Math.sin(angle) * radius,
        centre[2],
      ],
    });
  }

  return places;
}

/** A straight row of identical parts: bolts along a seam, louvers, draft ticks. */
export function row(
  count: number,
  from: Vec3,
  to: Vec3,
  rotation?: Vec3,
): Placement[] {
  const places: Placement[] = [];

  for (let i = 0; i < count; i += 1) {
    const u = count === 1 ? 0.5 : i / (count - 1);
    places.push({
      position: [mix(from[0], to[0], u), mix(from[1], to[1], u), mix(from[2], to[2], u)],
      rotation,
    });
  }

  return places;
}

export function disposeTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) object.geometry.dispose();
  });
}

/** A tapered strut spanning two points: mast legs, stanchions, tie rods. */
export function strut(
  bin: PartBin,
  tone: ToneKey,
  from: Vec3,
  to: Vec3,
  radiusTop: number,
  radiusBottom = radiusTop,
  segments = 10,
): void {
  const a = new THREE.Vector3(from[0], from[1], from[2]);
  const b = new THREE.Vector3(to[0], to[1], to[2]);
  const direction = b.clone().sub(a);
  const length = direction.length();
  if (length < 1e-6) return;

  const middle = a.clone().add(b).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    direction.clone().normalize(),
  );

  bin.add(tone, tubeZ(radiusTop, radiusBottom, length, segments), {
    position: [middle.x, middle.y, middle.z],
    quaternion,
  });
}
