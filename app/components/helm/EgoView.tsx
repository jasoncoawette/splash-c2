"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { BoatType, Position } from "../../core/types";
import type { HelmCamera, OrbitState } from "../../store/commandSlice.ts";
import { OBJECTIVE_ORANGE } from "../chart/objectiveArea";
import { ACCENT_HEX } from "../vessel/palette";
import { TEMPEST_LENGTH_M, tempestTemplate } from "../vessel/tempest";
import { TYPHOON_LENGTH_M, typhoonTemplate } from "../vessel/typhoon";
import { createDepthField } from "./bathymetry.ts";
import { buildCoastline } from "./coastline.ts";
import { buildSeabed } from "./seabed.ts";
import type { Contact } from "./frame";
import "./helmStage.css";

const METRES_PER_NM = 1852;

/**
 * Drawing choice, not a measurement: range is compressed logarithmically so a
 * contact a mile out is still on screen beside a 4 m hull. Bearing is exact —
 * the whole relative vector is scaled by one factor — and every label carries
 * the true range in nautical miles.
 */
const DEPTH_SCALE_M = 26;

/** Contacts are drawn oversize for the same reason the chart draws them oversize. */
const CONTACT_EXAGGERATION = 3.2;

/** The hull the operator's zoom distance is quoted against. */
const REFERENCE_HULL_M = TEMPEST_LENGTH_M;

const TRUE_LENGTH_M: Record<BoatType, number> = {
  TYPHOON: TYPHOON_LENGTH_M,
  TEMPEST: TEMPEST_LENGTH_M,
};

function templateFor(type: BoatType, selected: boolean): THREE.Group {
  return type === "TEMPEST" ? tempestTemplate(selected) : typhoonTemplate(selected);
}

function compress(distanceNm: number): number {
  return DEPTH_SCALE_M * Math.log1p((distanceNm * METRES_PER_NM) / DEPTH_SCALE_M);
}

/** Place a relative fix in the scene, keeping its bearing and compressing range. */
function scenePoint(forwardNm: number, rightNm: number, distanceNm: number) {
  const trueMetres = Math.max(distanceNm * METRES_PER_NM, 1);
  const ratio = compress(distanceNm) / trueMetres;

  return {
    x: rightNm * METRES_PER_NM * ratio,
    y: forwardNm * METRES_PER_NM * ratio,
  };
}

/** A sea that shows motion: a fading grid the hull drives over. */
/** Sky-to-sea gradient, filtered into an environment map for the hull's metal. */
const SKY_STOPS: Record<EgoTheme, readonly [number, string][]> = {
  DARK: [[0, "#9fd0e8"], [0.44, "#4e7a93"], [0.52, "#12222b"], [1, "#060d12"]],
  LIGHT: [[0, "#eaf5fc"], [0.44, "#c3dced"], [0.52, "#a8c6d8"], [1, "#8fb0c4"]],
};

function createSkyTexture(theme: EgoTheme): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 128;
  const context = canvas.getContext("2d");

  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, 128);
    for (const [stop, colour] of SKY_STOPS[theme]) gradient.addColorStop(stop, colour);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 16, 128);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * How far the drawn sea reaches before it dissolves. The boat does not sense
 * the whole ocean, and a ground plane that runs to the horizon claims it does.
 */
function createFieldMask(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");

  if (context) {
    const gradient = context.createRadialGradient(
      size / 2,
      size / 2,
      size * 0.04,
      size / 2,
      size / 2,
      size * 0.46,
    );
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.52, "#ffffff");
    gradient.addColorStop(0.74, "#9a9a9a");
    gradient.addColorStop(0.9, "#3a3a3a");
    gradient.addColorStop(1, "#000000");
    context.fillStyle = "#000000";
    context.fillRect(0, 0, size, size);
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function createSeaTexture(theme: EgoTheme): THREE.CanvasTexture {
  const palette = PALETTE[theme];
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");

  if (context) {
    // The surface is water over a bottom, so the tint goes in the texture and
    // the grid does not. Putting the translucency on the material instead —
    // which is what it used to do — faded both together: at an opacity low
    // enough to see depth through, the grid had gone, and at one high enough
    // to see the grid, the sea was a sheet with nothing under it.
    context.clearRect(0, 0, size, size);
    context.globalAlpha = palette.seaAlpha;
    context.fillStyle = palette.sea;
    context.fillRect(0, 0, size, size);

    context.globalAlpha = 1;
    context.strokeStyle = palette.grid;
    context.lineWidth = 2;
    context.strokeRect(0, 0, size, size);
    context.strokeStyle = palette.gridFaint;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(size / 2, 0);
    context.lineTo(size / 2, size);
    context.moveTo(0, size / 2);
    context.lineTo(size, size / 2);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(200, 200);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface EgoLane {
  forwardNm: number;
  rightNm: number;
  distanceNm: number;
}

/** A ship the boat can see but does not own: AIS traffic, drawn as a hull. */
export interface EgoTraffic extends EgoLane {
  mmsi: number;
  name: string;
  /** Its heading relative to ours, so it is drawn at its true aspect. */
  aspectDegrees: number;
  lengthM: number;
}

export type EgoTheme = "DARK" | "LIGHT";

/** The scene's colours. Light is a day sea, not an inverted night one. */
const PALETTE: Record<EgoTheme, {
  fog: number;
  /** Where haze starts and where it has taken everything, in metres. */
  fogNear: number;
  fogFar: number;
  sea: string;
  /** How much of the bottom the surface is allowed to hide. */
  seaAlpha: number;
  grid: string;
  gridFaint: string;
  traffic: number;
}> = {
  DARK: {
    fog: 0x061018,
    // Night: the dark closes in a few hundred metres out, which is the point.
    fogNear: 90,
    fogFar: 420,
    sea: "#0a2232",
    seaAlpha: 0.5,
    grid: "rgba(82, 203, 255, 0.32)",
    gridFaint: "rgba(82, 203, 255, 0.12)",
    traffic: 0x8fa6b4,
  },
  LIGHT: {
    fog: 0xcfdfe8,
    // Daylight sees for miles. At the night distances the haze reached full
    // strength four hundred metres out, and since it is near-white by day it
    // took the sea, the grid and every metre of depth with it — the white-out
    // was the fog, not the palette.
    fogNear: 400,
    fogFar: 2600,
    // Daylight water, not daylight paper: a pale chart blue here put the sea
    // within a shade of the sky and the whole stage read as a white-out.
    sea: "#7ca8c2",
    seaAlpha: 0.5,
    grid: "rgba(16, 64, 92, 0.45)",
    gridFaint: "rgba(16, 64, 92, 0.18)",
    traffic: 0x90a8b8,
  },
};

/**
 * A ribbon through the remaining waypoints, laid on the water. Built from the
 * route rather than from the next leg alone: an operator needs to see where the
 * boat is going, not only where it turns next.
 */
function routeGeometry(
  points: readonly { x: number; y: number }[],
  width: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const next = points[index + 1] ?? points[index];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * (width / 2);
    const ny = (dx / length) * (width / 2);

    positions.push(points[index].x + nx, points[index].y + ny, 0.06);
    positions.push(points[index].x - nx, points[index].y - ny, 0.06);

    if (index > 0) {
      const a = (index - 1) * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * A ship's plan at unit length: flat transom, parallel midbody, a bow that
 * comes to a point, extruded to a freeboard. Traffic used to be drawn as a
 * box, which at a quarter mile reads as a container floating on its own. This
 * still claims nothing beyond what AIS reports — a length, a beam ratio and an
 * aspect — but it reads as a vessel lying that way, which is the whole job.
 */
function hullPlanGeometry(): THREE.ExtrudeGeometry {
  const beam = 0.085;
  const plan = new THREE.Shape();
  plan.moveTo(-beam, -0.5);
  plan.lineTo(beam, -0.5);
  plan.lineTo(beam, 0.22);
  plan.quadraticCurveTo(beam, 0.42, 0, 0.5);
  plan.quadraticCurveTo(-beam, 0.42, -beam, 0.22);
  plan.closePath();

  const geometry = new THREE.ExtrudeGeometry(plan, {
    depth: 0.085,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 1,
    curveSegments: 6,
  });
  // Extruded from the waterline up, so a contact sits on the sea rather than
  // half in it.
  geometry.translate(0, 0, 0);
  return geometry;
}

interface EgoViewProps {
  type: BoatType;
  speedKnots: number;
  contacts: readonly Contact[];
  /** The next waypoint as a relative fix, or null when the boat is unassigned. */
  lane: EgoLane | null;
  /** Every waypoint still ahead, nearest first. */
  route: readonly EgoLane[];
  /** Other ships the chart knows about. */
  traffic: readonly EgoTraffic[];
  /**
   * The objective area's rim, sampled all the way round and handed over as
   * relative fixes. Null when no objective is standing.
   */
  objectiveRing: readonly EgoLane[] | null;
  theme: EgoTheme;
  manual: boolean;
  /** Which station the operator is looking from. */
  camera: HelmCamera;
  /** Where the external camera sits, when that is the station in use. */
  orbit: OrbitState;
  /** Where the boat is, so the shore drawn around it is the real one. */
  position: Position;
  headingDegrees: number;
  /** Drag and wheel on the stage move the camera around the hull. */
  onOrbit?: (delta: { yaw?: number; pitch?: number; distance?: number }) => void;
}

/** Where each station sits, in metres against the hull it is looking from. */
function placeCamera(
  view: THREE.PerspectiveCamera,
  station: HelmCamera,
  orbit: OrbitState,
  hullLength: number,
): void {
  if (station === "BOW") {
    view.position.set(0, hullLength * 0.42, 1.5);
    view.lookAt(0, hullLength * 6 + 40, 0.8);
    return;
  }

  if (station === "MAST") {
    view.position.set(0, -hullLength * 0.1, hullLength * 0.95 + 2.6);
    view.lookAt(0, hullLength * 6 + 30, 0);
    return;
  }

  if (station === "AFT") {
    view.position.set(0, -hullLength * 2.6 - 4, hullLength * 0.7 + 2.4);
    view.lookAt(0, hullLength * 5 + 22, 0);
    return;
  }

  // EXTERNAL: an orbit around the hull, which is the view the chase shot uses.
  const yaw = THREE.MathUtils.degToRad(orbit.yawDegrees);
  const pitch = THREE.MathUtils.degToRad(orbit.pitchDegrees);
  const distance = orbit.distanceM * (hullLength / REFERENCE_HULL_M);
  const ground = Math.cos(pitch) * distance;

  view.position.set(
    Math.sin(yaw) * ground,
    -Math.cos(yaw) * ground,
    Math.max(Math.sin(pitch) * distance, hullLength * 0.35),
  );
  view.lookAt(0, hullLength * 0.6, hullLength * 0.3);
}

interface ContactNode {
  root: THREE.Group;
  label: HTMLSpanElement;
  type: BoatType;
}

/**
 * The boat seen from just astern, with everything the console knows about
 * around it: the contacts the simulator reports, the lane to the next waypoint
 * and a sea that moves at the ordered speed. The hulls are the same procedural
 * models the chart draws, so a vessel looks like itself in both views.
 */
export default function EgoView({
  type,
  speedKnots,
  contacts,
  lane,
  route,
  traffic,
  objectiveRing,
  theme,
  manual,
  camera: station,
  orbit,
  position,
  headingDegrees,
  onOrbit,
}: EgoViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ type, speedKnots, contacts, lane, route, traffic, objectiveRing, theme, manual, station, orbit, position, headingDegrees });

  // The render loop reads the latest props through this ref rather than being
  // rebuilt whenever one changes; the scene outlives any single render.
  useEffect(() => {
    propsRef.current = { type, speedKnots, contacts, lane, route, traffic, objectiveRing, theme, manual, station, orbit, position, headingDegrees };
  });

  useEffect(() => {
    if (!containerRef.current || !labelLayerRef.current) return;

    // Held as non-null locals so the render loop below can close over them.
    const container: HTMLDivElement = containerRef.current;
    const labelLayer: HTMLDivElement = labelLayerRef.current;

    // Balanced for the theme the stage opens in, not only for the one it is
    // switched to: the helm is usually entered already in daylight or already
    // at night, and that path must not be the unlit one.
    const openedInDaylight = propsRef.current.theme === "LIGHT";
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = openedInDaylight ? 1 : 1.15;
    container.append(renderer.domElement);

    const scene = new THREE.Scene();
    const openingPalette = PALETTE[propsRef.current.theme];
    scene.fog = new THREE.Fog(
      openingPalette.fog,
      openingPalette.fogNear,
      openingPalette.fogFar,
    );

    // Same environment as the chart's hulls: without it the metal is black.
    const generator = new THREE.PMREMGenerator(renderer);
    const sky = createSkyTexture(propsRef.current.theme);
    let environment = generator.fromEquirectangular(sky);
    scene.environment = environment.texture;
    scene.environmentIntensity = openedInDaylight ? 1.15 : 0.55;
    sky.dispose();
    generator.dispose();

    // The chart's lighting recipe, so a hull reads the same in both views.
    const hemisphere = new THREE.HemisphereLight(
      0xcfe8f5,
      openedInDaylight ? 0xc9d9e2 : 0x16222a,
      openedInDaylight ? 2.4 : 1.2,
    );
    scene.add(hemisphere);
    const key = new THREE.DirectionalLight(0xfff4e4, openedInDaylight ? 2.1 : 2.8);
    key.position.set(-0.55, -0.9, 1.1);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xdcf0ff, openedInDaylight ? 0.5 : 0.9);
    rim.position.set(0.1, 1, -0.2);
    scene.add(rim);

    // +Y is forward and +Z is up, matching how the hulls are modelled.
    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 40000);
    camera.up.set(0, 0, 1);

    let appliedTheme = propsRef.current.theme;
    let seaTexture = createSeaTexture(appliedTheme);
    // The grid scrolls with the boat; the field mask does not, because the edge
    // of what is sensed belongs to the sensor rather than to the water.
    const fieldMask = createFieldMask();
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshBasicMaterial({
        map: seaTexture,
        alphaMap: fieldMask,
        transparent: true,
        // Full: what the surface hides is decided by the texture's own alpha,
        // which tints the water without touching the grid drawn on it.
        opacity: 1,
        depthWrite: false,
      }),
    );
    sea.renderOrder = -2;
    scene.add(sea);

    // The route ahead, laid on the water as one ribbon through the waypoints.
    const routeMaterial = new THREE.MeshBasicMaterial({
      color: ACCENT_HEX,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    let routeMesh: THREE.Mesh | null = null;
    let routeKey = "";

    const waypointMarkers = new THREE.Group();
    scene.add(waypointMarkers);

    function syncRoute(legs: readonly EgoLane[], hullLength: number): void {
      const key = legs.map((leg) => `${leg.forwardNm.toFixed(4)},${leg.rightNm.toFixed(4)}`).join("|");
      if (key === routeKey) return;
      routeKey = key;

      if (routeMesh) {
        scene.remove(routeMesh);
        routeMesh.geometry.dispose();
        routeMesh = null;
      }
      waypointMarkers.clear();

      if (legs.length === 0) return;

      const points = [{ x: 0, y: 0 }, ...legs.map((leg) =>
        scenePoint(leg.forwardNm, leg.rightNm, leg.distanceNm))];
      routeMesh = new THREE.Mesh(routeGeometry(points, hullLength * 0.45), routeMaterial);
      routeMesh.frustumCulled = false;
      routeMesh.renderOrder = 3;
      scene.add(routeMesh);

      for (const point of points.slice(1)) {
        const marker = new THREE.Mesh(
          new THREE.RingGeometry(hullLength * 0.5, hullLength * 0.62, 24),
          routeMaterial,
        );
        marker.position.set(point.x, point.y, 0.07);
        marker.renderOrder = 4;
        marker.frustumCulled = false;
        waypointMarkers.add(marker);
      }
    }

    // THE OBJECTIVE AREA, SEEN FROM THE WATER
    //
    // The same orange ground the fleet chart draws, on the sea the operator is
    // actually looking at. Every point of the rim is placed through the same
    // range compression as the route, the contacts and the traffic, so the ring
    // bends exactly the way this view bends: a rim half a mile off sits where
    // half a mile off sits, and the far side of the area is further away than
    // the near side rather than being a circle painted flat on the water.
    const objectiveLine = new THREE.MeshBasicMaterial({
      color: OBJECTIVE_ORANGE[propsRef.current.theme],
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const objectiveFill = new THREE.MeshBasicMaterial({
      color: OBJECTIVE_ORANGE[propsRef.current.theme],
      transparent: true,
      opacity: 0.09,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    let objectiveRim: THREE.Mesh | null = null;
    let objectiveGround: THREE.Mesh | null = null;
    let objectiveKey = "";

    function syncObjective(ring: readonly EgoLane[] | null, hullLength: number): void {
      const key = ring === null
        ? ""
        : ring.map((point) => `${point.forwardNm.toFixed(4)},${point.rightNm.toFixed(4)}`).join("|");
      if (key === objectiveKey) return;
      objectiveKey = key;

      if (objectiveRim) {
        scene.remove(objectiveRim);
        objectiveRim.geometry.dispose();
        objectiveRim = null;
      }

      if (objectiveGround) {
        scene.remove(objectiveGround);
        objectiveGround.geometry.dispose();
        objectiveGround = null;
      }

      if (ring === null || ring.length < 3) return;

      const points = ring.map((point) =>
        scenePoint(point.forwardNm, point.rightNm, point.distanceNm));

      // The rim is a ribbon rather than a line, because a one-pixel loop
      // disappears at the far side of the area and thickens at the near side,
      // which is the wrong way round.
      objectiveRim = new THREE.Mesh(
        routeGeometry([...points, points[0]], hullLength * 0.3),
        objectiveLine,
      );
      objectiveRim.frustumCulled = false;
      objectiveRim.renderOrder = 2;
      scene.add(objectiveRim);

      // The ground inside it, as a fan from the area's own centre in scene
      // space. Triangulating against the compressed points rather than drawing
      // a disc keeps the fill under the rim wherever the compression has put it.
      const centreX = points.reduce((total, point) => total + point.x, 0) / points.length;
      const centreY = points.reduce((total, point) => total + point.y, 0) / points.length;
      const positions: number[] = [centreX, centreY, 0.04];
      for (const point of points) positions.push(point.x, point.y, 0.04);

      const indices: number[] = [];
      for (let index = 1; index <= points.length; index += 1) {
        indices.push(0, index, index === points.length ? 1 : index + 1);
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);

      objectiveGround = new THREE.Mesh(geometry, objectiveFill);
      objectiveGround.frustumCulled = false;
      objectiveGround.renderOrder = 1;
      scene.add(objectiveGround);
    }

    // The real shore around the boat, rebuilt only when it has moved far enough
    // or turned far enough to matter: a few hundred metres of travel changes
    // nothing a camera can see at this range.
    const shore = new THREE.Group();
    scene.add(shore);
    let shoreMesh: ReturnType<typeof buildCoastline> | null = null;
    let shoreAt: { latitude: number; longitude: number; headingDegrees: number } | null = null;

    function syncShore(at: Position, heading: number): void {
      const moved = !shoreAt
        || Math.abs(at.latitude - shoreAt.latitude) > 0.002
        || Math.abs(at.longitude - shoreAt.longitude) > 0.002
        || Math.abs(((heading - shoreAt.headingDegrees + 540) % 360) - 180) > 2;
      if (!moved) return;

      shoreMesh?.dispose();
      shore.clear();
      shoreMesh = buildCoastline(at, heading);
      shore.add(shoreMesh.group);
      shoreAt = { latitude: at.latitude, longitude: at.longitude, headingDegrees: heading };
    }

    // THE BOTTOM
    //
    // Real bathymetry, decoded from the Open Waters DEM and laid under the
    // hull at its true depth. The tiles arrive over the network, so the first
    // build usually finds nothing and the revision counter brings it back once
    // they land.
    const depthField = createDepthField();
    const seabed = new THREE.Group();
    scene.add(seabed);
    let seabedMesh: ReturnType<typeof buildSeabed> | null = null;
    let seabedAt: {
      latitude: number;
      longitude: number;
      headingDegrees: number;
      revision: number;
      theme: EgoTheme;
    } | null = null;

    function syncSeabed(at: Position, heading: number, theme: EgoTheme): void {
      // Fire and forget: a tile that lands bumps the revision, which brings
      // this straight back on the next frame.
      void depthField.ensure(at, 3000);

      const moved = !seabedAt
        || Math.abs(at.latitude - seabedAt.latitude) > 0.002
        || Math.abs(at.longitude - seabedAt.longitude) > 0.002
        || Math.abs(((heading - seabedAt.headingDegrees + 540) % 360) - 180) > 2
        || seabedAt.revision !== depthField.revision()
        || seabedAt.theme !== theme;
      if (!moved) return;

      seabedMesh?.dispose();
      seabed.clear();
      seabedMesh = buildSeabed(at, heading, depthField, theme);
      seabed.add(seabedMesh.group);
      seabedAt = {
        latitude: at.latitude,
        longitude: at.longitude,
        headingDegrees: heading,
        revision: depthField.revision(),
        theme,
      };
    }

    const ego = new THREE.Group();
    scene.add(ego);

    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const shadowContext = shadowCanvas.getContext("2d");

    if (shadowContext) {
      const gradient = shadowContext.createRadialGradient(64, 64, 2, 64, 64, 62);
      gradient.addColorStop(0, "rgba(2, 8, 11, 0.75)");
      gradient.addColorStop(1, "rgba(2, 8, 11, 0)");
      shadowContext.fillStyle = gradient;
      shadowContext.fillRect(0, 0, 128, 128);
    }

    const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    const shadowMaterial = new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      depthWrite: false,
      // Disturbed water under a hull is a dark patch at night and barely a
      // smudge in daylight; a night-weight shadow on a pale sea reads as a hole.
      opacity: propsRef.current.theme === "LIGHT" ? 0.32 : 1,
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMaterial);
    shadow.position.z = 0.02;
    shadow.renderOrder = -1;
    scene.add(shadow);
    let egoType: BoatType | null = null;
    let egoModel: THREE.Group | null = null;

    const contactNodes = new Map<string, ContactNode>();
    const projection = new THREE.Vector3();

    function syncEgo(nextType: BoatType): void {
      if (egoType === nextType) return;
      if (egoModel) ego.remove(egoModel);

      egoModel = templateFor(nextType, true).clone();
      ego.add(egoModel);
      egoType = nextType;
    }

    function syncContacts(live: readonly Contact[]): void {
      const seen = new Set(live.map((contact) => contact.id));

      for (const [id, node] of contactNodes) {
        if (seen.has(id)) continue;
        scene.remove(node.root);
        node.label.remove();
        contactNodes.delete(id);
      }

      for (const contact of live) {
        let node = contactNodes.get(contact.id);

        if (node && node.type !== contact.type) {
          scene.remove(node.root);
          node.label.remove();
          contactNodes.delete(contact.id);
          node = undefined;
        }

        if (!node) {
          const root = new THREE.Group();
          root.add(templateFor(contact.type, false).clone());
          root.scale.setScalar(CONTACT_EXAGGERATION);
          scene.add(root);

          const label = document.createElement("span");
          label.className = "ego-contact";
          labelLayer.append(label);

          node = { root, label, type: contact.type };
          contactNodes.set(contact.id, node);
        }

        const point = scenePoint(contact.forwardNm, contact.rightNm, contact.distanceNm);
        node.root.position.set(point.x, point.y, 0);
        // Our own bow points up the scene, so a contact's aspect is its heading
        // relative to ours. Rotation about Z is negative towards starboard.
        node.root.rotation.z = -THREE.MathUtils.degToRad(contact.aspectDegrees);
        node.label.textContent = `${contact.id} · ${contact.distanceNm.toFixed(2)} NM`;
      }
    }

    // Traffic the chart knows about, drawn as plain hulls: we have a name, a
    // length and an aspect for each, and no model, so the shape says "a ship
    // this long lies that way" and claims nothing further.
    const trafficGroup = new THREE.Group();
    scene.add(trafficGroup);
    const trafficMaterial = new THREE.MeshStandardMaterial({
      color: PALETTE[propsRef.current.theme].traffic,
      roughness: 0.75,
      metalness: 0.1,
    });
    // One geometry for every contact: the hull plan is identical and only the
    // scale and the aspect differ, so a harbour full of traffic costs one.
    const trafficHull = hullPlanGeometry();
    const trafficNodes = new Map<number, THREE.Mesh>();

    function syncTraffic(ships: readonly EgoTraffic[]): void {
      const live = new Set(ships.map((ship) => ship.mmsi));

      for (const [mmsi, node] of trafficNodes) {
        if (live.has(mmsi)) continue;
        // The geometry is shared, so a contact that has aged out takes its
        // node with it and leaves the hull plan for the rest.
        trafficGroup.remove(node);
        trafficNodes.delete(mmsi);
      }

      for (const ship of ships) {
        let node = trafficNodes.get(ship.mmsi);
        const length = ship.lengthM > 0 ? ship.lengthM : 30;

        if (!node) {
          node = new THREE.Mesh(trafficHull, trafficMaterial);
          node.frustumCulled = false;
          trafficGroup.add(node);
          trafficNodes.set(ship.mmsi, node);
        }

        const point = scenePoint(ship.forwardNm, ship.rightNm, ship.distanceNm);
        // Range is compressed, so size is compressed with it: a ship keeps the
        // angular size it would really have instead of becoming a wall when a
        // 300 m hull is folded in to a few scene metres.
        const trueMetres = Math.max(ship.distanceNm * METRES_PER_NM, 1);
        // No exaggeration here, unlike our own hulls: a merchant ship is already
        // big enough to read at its true angular size, and inflating it would
        // say the harbour is fuller than it is. Only a floor, so a small craft
        // does not vanish.
        const drawn = Math.max(length * (compress(ship.distanceNm) / trueMetres), 4);

        node.scale.set(drawn, drawn, drawn);
        node.position.set(point.x, point.y, 0);
        node.rotation.z = -THREE.MathUtils.degToRad(ship.aspectDegrees);
      }
    }

    function placeLabels(): void {
      const width = container.clientWidth;
      const height = container.clientHeight;

      for (const node of contactNodes.values()) {
        projection.set(node.root.position.x, node.root.position.y, 6);
        projection.project(camera);

        const x = (projection.x * 0.5 + 0.5) * width;
        const y = (-projection.y * 0.5 + 0.5) * height;
        const onScreen = projection.z < 1 && x > -40 && x < width + 40;

        // Centred just above the projected hull. The plate carries a short
        // leader in CSS, so it reads as attached without covering the model.
        node.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -115%)`;
        node.label.dataset.visible = onScreen ? "true" : "false";
      }
    }

    function resize(): void {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;

      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let frame = 0;
    let previous = performance.now();

    function draw(now: number): void {
      frame = requestAnimationFrame(draw);
      const delta = Math.min((now - previous) / 1000, 0.1);
      previous = now;

      const live = propsRef.current;

      // The scene follows the theme without remounting: a day sea is a
      // different sea, not a lighter screen.
      if (live.theme !== appliedTheme) {
        appliedTheme = live.theme;
        const palette = PALETTE[appliedTheme];
        const next = createSeaTexture(appliedTheme);
        next.offset.copy(seaTexture.offset);
        seaTexture.dispose();
        seaTexture = next;
        const material = sea.material as THREE.MeshBasicMaterial;
        material.map = seaTexture;
        material.needsUpdate = true;
        trafficMaterial.color.setHex(palette.traffic);
        objectiveLine.color.set(OBJECTIVE_ORANGE[appliedTheme]);
        objectiveFill.color.set(OBJECTIVE_ORANGE[appliedTheme]);
        if (scene.fog instanceof THREE.Fog) {
          scene.fog.color.setHex(palette.fog);
          scene.fog.near = palette.fogNear;
          scene.fog.far = palette.fogFar;
        }

        // Daylight is a different light, not a brighter night: the sky the hull
        // reflects is rebuilt and the lamps are re-balanced with it.
        const daylight = appliedTheme === "LIGHT";
        const nextGenerator = new THREE.PMREMGenerator(renderer);
        const nextSky = createSkyTexture(appliedTheme);
        const nextEnvironment = nextGenerator.fromEquirectangular(nextSky);
        environment.dispose();
        environment = nextEnvironment;
        scene.environment = environment.texture;
        scene.environmentIntensity = daylight ? 1.15 : 0.55;
        nextSky.dispose();
        nextGenerator.dispose();

        hemisphere.intensity = daylight ? 2.4 : 1.2;
        hemisphere.groundColor.setHex(daylight ? 0xc9d9e2 : 0x16222a);
        key.intensity = daylight ? 2.1 : 2.8;
        rim.intensity = daylight ? 0.5 : 0.9;
        renderer.toneMappingExposure = daylight ? 1 : 1.15;
        shadowMaterial.opacity = daylight ? 0.32 : 1;
      }

      syncShore(live.position, live.headingDegrees);
      syncSeabed(live.position, live.headingDegrees, live.theme);
      syncEgo(live.type);
      syncContacts(live.contacts);

      // The sea scrolls at the ordered speed, which is what makes the view read
      // as under way rather than as a diagram.
      const metresPerSecond = (live.speedKnots * METRES_PER_NM) / 3600;
      seaTexture.offset.y -= (metresPerSecond * delta) / (4000 / 140);

      const seconds = now / 1000;
      const roll = Math.sin(seconds * 0.6) * 0.016 + Math.sin(seconds * 1.7) * 0.004;
      const heave = Math.sin(seconds * 0.9) * 0.08;
      const hullLength = TRUE_LENGTH_M[live.type];

      ego.position.set(0, 0, heave);
      ego.rotation.set(0, roll, 0);
      shadow.scale.set(hullLength * 2.4, hullLength * 2.8, 1);

      syncRoute(live.route, hullLength);
      syncObjective(live.objectiveRing, hullLength);
      syncTraffic(live.traffic);

      placeCamera(camera, live.station, live.orbit, hullLength);

      placeLabels();
      renderer.render(scene, camera);
    }

    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();

      for (const node of contactNodes.values()) node.label.remove();
      contactNodes.clear();
      // Templates are shared singletons owned by the vessel module; only the
      // geometry and textures created here are disposed.
      seabedMesh?.dispose();
      depthField.dispose();
      shoreMesh?.dispose();
      sea.geometry.dispose();
      (sea.material as THREE.Material).dispose();
      seaTexture.dispose();
      routeMesh?.geometry.dispose();
      routeMaterial.dispose();
      objectiveRim?.geometry.dispose();
      objectiveGround?.geometry.dispose();
      objectiveLine.dispose();
      objectiveFill.dispose();
      trafficMaterial.dispose();
      trafficHull.dispose();
      for (const marker of waypointMarkers.children) {
        if (marker instanceof THREE.Mesh) marker.geometry.dispose();
      }
      fieldMask.dispose();
      shadow.geometry.dispose();
      (shadow.material as THREE.Material).dispose();
      shadowTexture.dispose();
      environment.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const orbitRef = useRef(onOrbit);

  useEffect(() => {
    orbitRef.current = onOrbit;
  });

  // Dragging the scene swings the camera round the hull, the way you would turn
  // a model in your hands. The hull never moves: this is a view, not an order.
  useEffect(() => {
    const view = containerRef.current;
    if (!view) return;

    let pointerId: number | null = null;
    let last = { x: 0, y: 0 };

    function down(event: PointerEvent): void {
      if (event.button !== 0) return;
      pointerId = event.pointerId;
      last = { x: event.clientX, y: event.clientY };
      document.body.dataset.chartDrag = "drag";
    }

    function move(event: PointerEvent): void {
      if (pointerId === null || event.pointerId !== pointerId) return;

      orbitRef.current?.({
        yaw: (event.clientX - last.x) * 0.4,
        pitch: (event.clientY - last.y) * 0.25,
      });
      last = { x: event.clientX, y: event.clientY };
    }

    function up(event: PointerEvent): void {
      if (pointerId === null || event.pointerId !== pointerId) return;
      pointerId = null;
      delete document.body.dataset.chartDrag;
    }

    function wheel(event: WheelEvent): void {
      event.preventDefault();
      orbitRef.current?.({ distance: event.deltaY * 0.0012 });
    }

    view.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    view.addEventListener("wheel", wheel, { passive: false });

    return () => {
      view.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      view.removeEventListener("wheel", wheel);
      delete document.body.dataset.chartDrag;
    };
  }, []);

  return (
    <div className="ego-view">
      <div className="ego-canvas" ref={containerRef} />
      <div className="ego-field" aria-hidden="true" />
      <div className="ego-fade" aria-hidden="true" />
      <div className="ego-labels" ref={labelLayerRef} />
      <span className={`ego-mode${manual ? " is-live" : ""}`}>
        {manual ? "HELM TAKEN" : "AUTOPILOT"}
      </span>
    </div>
  );
}
