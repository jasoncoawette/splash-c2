import mapboxgl, { type CustomLayerInterface, type Map as MapboxMap } from "mapbox-gl";
import * as THREE from "three";
import { ACCENT_HEX } from "./palette";
import { TEMPEST_LENGTH_M, tempestTemplate } from "./tempest";
import { TYPHOON_LENGTH_M, typhoonTemplate } from "./typhoon";

export type VesselType = "TYPHOON" | "TEMPEST";

export interface VesselMapBoat {
  id: string;
  name: string;
  type: VesselType;
  longitude: number;
  latitude: number;
  headingDegrees: number;
  speedKnots: number;
  selected: boolean;
  /** In the operator's current selection, without being the lead. */
  grouped?: boolean;
  /** Command link is down; draw the hull's operational cue as an alert. */
  linkLost?: boolean;
  /** Group colour, when this boat belongs to one. */
  tint?: string;
  /** Stable lane used to separate nearby 3D nameplates. */
  labelSlot?: -1 | 0 | 1;
}

export interface VesselCustomLayer extends CustomLayerInterface {
  setBoats: (boats: readonly VesselMapBoat[]) => void;
}

/**
 * How long each class is drawn on the chart. The hulls are modelled at true
 * size in metres, but a 3.9 m boat is two pixels at harbour zoom, so the map
 * draws them oversize. Past the crossover zoom the drawn length is constant in
 * metres, so flying in genuinely reveals more of the boat; below it the hull is
 * held at a floor in screen pixels so it never disappears.
 */
export const DISPLAY_LENGTH_M: Record<VesselType, number> = {
  TYPHOON: 105,
  TEMPEST: 170,
};

const MIN_SCREEN_PX = 32;

function metresPerPixel(map: MapboxMap): number {
  const latitude = map.getCenter().lat;
  return (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** map.getZoom();
}

function drawnLength(type: VesselType, metresPerPixelValue: number): number {
  return Math.max(DISPLAY_LENGTH_M[type], MIN_SCREEN_PX * metresPerPixelValue);
}

const TRUE_LENGTH_M: Record<VesselType, number> = {
  TYPHOON: TYPHOON_LENGTH_M,
  TEMPEST: TEMPEST_LENGTH_M,
};

function templateFor(type: VesselType, selected: boolean): THREE.Group {
  return type === "TEMPEST" ? tempestTemplate(selected) : typhoonTemplate(selected);
}

// -- water contact ------------------------------------------------------------

let wakeTexture: THREE.CanvasTexture | null = null;

/** Disturbed water under the hull: a soft shadow, bow foam and a spreading wake. */
function createWakeTexture(): THREE.CanvasTexture {
  if (wakeTexture) return wakeTexture;

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");

  if (!context) {
    wakeTexture = new THREE.CanvasTexture(canvas);
    return wakeTexture;
  }

  // Texture space: +v is forward. The hull sits around v = 0.62.
  const hullX = size / 2;
  const hullY = size * 0.38;

  const shadow = context.createRadialGradient(hullX, hullY, 2, hullX, hullY, size * 0.22);
  shadow.addColorStop(0, "rgba(2, 8, 11, 0.55)");
  shadow.addColorStop(1, "rgba(2, 8, 11, 0)");
  context.fillStyle = shadow;
  context.fillRect(0, 0, size, size);

  // Quarter wake spreading aft from the bow shoulders.
  for (const side of [-1, 1]) {
    context.beginPath();
    context.moveTo(hullX + side * size * 0.03, hullY - size * 0.1);
    context.quadraticCurveTo(
      hullX + side * size * 0.16,
      hullY + size * 0.18,
      hullX + side * size * 0.34,
      hullY + size * 0.5,
    );
    context.lineWidth = size * 0.055;
    context.lineCap = "round";
    const streak = context.createLinearGradient(hullX, hullY, hullX, size);
    streak.addColorStop(0, "rgba(214, 238, 248, 0.5)");
    streak.addColorStop(0.55, "rgba(190, 224, 240, 0.22)");
    streak.addColorStop(1, "rgba(190, 224, 240, 0)");
    context.strokeStyle = streak;
    context.stroke();
  }

  // Bow foam.
  const foam = context.createRadialGradient(hullX, hullY - size * 0.12, 1, hullX, hullY - size * 0.12, size * 0.1);
  foam.addColorStop(0, "rgba(232, 246, 252, 0.65)");
  foam.addColorStop(1, "rgba(232, 246, 252, 0)");
  context.fillStyle = foam;
  context.fillRect(0, 0, size, size);

  wakeTexture = new THREE.CanvasTexture(canvas);
  wakeTexture.colorSpace = THREE.SRGBColorSpace;
  return wakeTexture;
}

/** Vertical sky-to-sea gradient, filtered into an environment map for the metal. */
function createSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 128;
  const context = canvas.getContext("2d");

  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, "#9fd0e8");
    gradient.addColorStop(0.44, "#4e7a93");
    gradient.addColorStop(0.52, "#12222b");
    gradient.addColorStop(1, "#060d12");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 16, 128);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Corner brackets around the hull, in the boat's own frame and in true metres.
 *
 * Drawn here rather than as a DOM marker so they are locked to the hull: they
 * pitch, rotate and scale with it, sit on the water the boat sits on, and
 * cannot drift away from it when the camera moves. A screen-space bracket is a
 * label about a boat; this is a mark on the water around it.
 */
function bracketGeometry(
  halfX: number,
  halfY: number,
  arm: number,
  thickness: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const half = thickness / 2;

  const quad = (x0: number, y0: number, x1: number, y1: number) => {
    positions.push(
      x0, y0, 0, x1, y0, 0, x1, y1, 0,
      x0, y0, 0, x1, y1, 0, x0, y1, 0,
    );
  };

  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const cornerX = sx * halfX;
      const cornerY = sy * halfY;

      // The arm running along the beam, and the one running along the length.
      const innerX = cornerX - sx * arm;
      quad(
        Math.min(cornerX, innerX) - (sx < 0 ? 0 : half),
        cornerY - half,
        Math.max(cornerX, innerX) + (sx < 0 ? half : 0),
        cornerY + half,
      );

      const innerY = cornerY - sy * arm;
      quad(
        cornerX - half,
        Math.min(cornerY, innerY),
        cornerX + half,
        Math.max(cornerY, innerY),
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

interface BoatNode {
  root: THREE.Group;
  model: THREE.Group;
  wakeMaterial: THREE.MeshBasicMaterial;
  brackets: THREE.Mesh;
  bracketMaterial: THREE.MeshBasicMaterial;
  label: THREE.Sprite;
  labelMaterial: THREE.SpriteMaterial;
  labelTexture: THREE.CanvasTexture;
  labelKey: string;
  type: VesselType;
  selected: boolean;
  boat: VesselMapBoat;
}

function labelKey(boat: VesselMapBoat): string {
  return [boat.name, boat.type, boat.tint ?? ACCENT_HEX, boat.selected, boat.linkLost].join("|");
}

/** A boat-relative billboard. It shares the hull's map transform and altitude. */
function createLabelTexture(boat: VesselMapBoat): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 96;
  const context = canvas.getContext("2d");

  if (context) {
    const accent = boat.linkLost ? "#ff6e6e" : boat.tint ?? "#52cbff";
    context.fillStyle = "rgba(4, 13, 18, 0.9)";
    context.fillRect(2, 2, 380, 92);
    context.strokeStyle = accent;
    context.lineWidth = boat.selected ? 4 : 2;
    context.strokeRect(3, 3, 378, 90);
    context.fillStyle = "#f4fbff";
    context.font = "600 30px sans-serif";
    context.textBaseline = "middle";
    context.fillText(boat.name.split(" ")[0] ?? boat.id, 20, 36);
    context.fillStyle = accent;
    context.font = "600 20px sans-serif";
    context.fillText(boat.type, 20, 68);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createLabel(boat: VesselMapBoat, trueLength: number) {
  const texture = createLabelTexture(boat);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(trueLength * 2.4, trueLength * 0.6, 1);
  sprite.center.set(0.5, 0);
  sprite.frustumCulled = false;
  sprite.renderOrder = 10;

  return { sprite, material, texture };
}

function createBoatNode(boat: VesselMapBoat): BoatNode {
  const root = new THREE.Group();
  const trueLength = TRUE_LENGTH_M[boat.type];

  const model = templateFor(boat.type, boat.selected).clone();
  root.add(model);

  const wakeMaterial = new THREE.MeshBasicMaterial({
    map: createWakeTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  const wake = new THREE.Mesh(
    new THREE.PlaneGeometry(trueLength * 1.9, trueLength * 2.1),
    wakeMaterial,
  );
  wake.position.set(0, -trueLength * 0.28, 0.02);
  wake.renderOrder = -1;
  wake.frustumCulled = false;
  root.add(wake);

  // Sized off the hull it belongs to, with a margin, so a Tempest's brackets
  // are visibly bigger than a Typhoon's rather than one size for both.
  const beam = trueLength * 0.4;
  const halfY = trueLength * 0.62;
  const halfX = Math.max(beam * 0.95, trueLength * 0.26);
  const bracketMaterial = new THREE.MeshBasicMaterial({
    color: boat.tint ?? ACCENT_HEX,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const brackets = new THREE.Mesh(
    bracketGeometry(halfX, halfY, Math.min(halfX, halfY) * 0.5, trueLength * 0.022),
    bracketMaterial,
  );
  brackets.position.z = 0.05;
  brackets.visible = boat.selected || boat.grouped === true;
  brackets.frustumCulled = false;
  brackets.renderOrder = 2;
  root.add(brackets);

  const tag = createLabel(boat, trueLength);
  root.add(tag.sprite);

  return {
    root,
    model,
    wakeMaterial,
    brackets,
    bracketMaterial,
    label: tag.sprite,
    labelMaterial: tag.material,
    labelTexture: tag.texture,
    labelKey: labelKey(boat),
    type: boat.type,
    selected: boat.selected,
    boat,
  };
}

function placeNode(node: BoatNode, boat: VesselMapBoat, metresPerPixelValue: number): void {
  node.boat = boat;

  const coordinate = mapboxgl.MercatorCoordinate.fromLngLat(
    [boat.longitude, boat.latitude],
    0,
  );
  const metre = coordinate.meterInMercatorCoordinateUnits();
  const scale = metre
    * (drawnLength(boat.type, metresPerPixelValue) / TRUE_LENGTH_M[boat.type]);

  node.root.position.set(coordinate.x, coordinate.y, coordinate.z);
  // Mercator y grows southward, so the model is mirrored into the map frame.
  // With that mirror in place a compass heading is a positive rotation about z.
  node.root.scale.set(scale, -scale, scale);
  node.root.rotation.z = THREE.MathUtils.degToRad(boat.headingDegrees);

  node.wakeMaterial.opacity = Math.min(Math.abs(boat.speedKnots) / 18, 1) * 0.85;
  node.brackets.visible = boat.selected || boat.grouped === true;
  node.bracketMaterial.color.set(boat.tint ?? ACCENT_HEX);
  // The lead of a selection is brighter than the rest of its group.
  node.bracketMaterial.opacity = boat.linkLost ? 1 : boat.selected ? 0.95 : 0.55;

  const trueLength = TRUE_LENGTH_M[boat.type];
  const slot = boat.labelSlot ?? 0;
  // Height is part of the boat's world transform, so the plate stays above the
  // hull through pitch, bearing and zoom. Nearby labels fan into stable lanes.
  node.label.position.set(slot * trueLength * 0.72, 0, trueLength * (0.72 + Math.abs(slot) * 0.22));
}

export function createVesselLayer(
  initialBoats: readonly VesselMapBoat[],
): VesselCustomLayer {
  let map: MapboxMap | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let environment: THREE.WebGLRenderTarget | null = null;
  let boats = [...initialBoats];

  let metresPerPixelValue = 1;
  const camera = new THREE.Camera();
  const scene = new THREE.Scene();
  const fleetRoot = new THREE.Group();
  const nodes = new Map<string, BoatNode>();

  scene.add(new THREE.HemisphereLight(0xcfe8f5, 0x16222a, 1.25));

  const key = new THREE.DirectionalLight(0xfff4e4, 3.2);
  key.position.set(-0.55, -0.9, 1.1);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x5f8ca3, 0.55);
  fill.position.set(0.8, 0.5, 0.35);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xdcf0ff, 0.95);
  rim.position.set(0.1, 1, -0.2);
  scene.add(rim);

  scene.add(fleetRoot);

  function syncBoats(): void {
    if (map) metresPerPixelValue = metresPerPixel(map);
    const live = new Set(boats.map((boat) => boat.id));

    for (const [id, node] of nodes) {
      if (live.has(id)) continue;
      fleetRoot.remove(node.root);
      // Model geometry belongs to the shared template, so only the per-boat
      // water decal and halo are disposed here.
      node.wakeMaterial.dispose();
      node.bracketMaterial.dispose();
      node.brackets.geometry.dispose();
      node.labelMaterial.dispose();
      node.labelTexture.dispose();
      nodes.delete(id);
    }

    for (const boat of boats) {
      let node = nodes.get(boat.id);

      if (node && (node.type !== boat.type || node.selected !== boat.selected)) {
        node.root.remove(node.model);
        node.model = templateFor(boat.type, boat.selected).clone();
        node.root.add(node.model);
        node.type = boat.type;
        node.selected = boat.selected;
      }

      if (node && node.labelKey !== labelKey(boat)) {
        const replacement = createLabelTexture(boat);
        node.labelTexture.dispose();
        node.labelTexture = replacement;
        node.labelMaterial.map = replacement;
        node.labelMaterial.needsUpdate = true;
        node.labelKey = labelKey(boat);
      }

      if (!node) {
        node = createBoatNode(boat);
        node.root.userData.boatId = boat.id;
        nodes.set(boat.id, node);
        fleetRoot.add(node.root);
      }

      placeNode(node, boat, metresPerPixelValue);
    }

    map?.triggerRepaint();
  }

  function attachEnvironment(activeRenderer: THREE.WebGLRenderer): void {
    if (environment) return;

    try {
      const generator = new THREE.PMREMGenerator(activeRenderer);
      const sky = createSkyTexture();
      environment = generator.fromEquirectangular(sky);
      scene.environment = environment.texture;
      scene.environmentIntensity = 0.5;
      sky.dispose();
      generator.dispose();
    } catch {
      // Without an environment map the lights alone still read correctly.
      environment = null;
      scene.environmentIntensity = 0;
    }
  }

  return {
    id: "splash-vessels-3d",
    type: "custom",
    renderingMode: "3d",

    setBoats(nextBoats) {
      boats = [...nextBoats];
      syncBoats();
    },

    onAdd(nextMap, gl) {
      map = nextMap;
      renderer = new THREE.WebGLRenderer({
        canvas: nextMap.getCanvas(),
        context: gl,
        antialias: true,
      });
      renderer.autoClear = false;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      syncBoats();
    },

    render(_gl, matrix) {
      if (!renderer) return;
      // Built on the first frame so the environment render happens inside our
      // own state block rather than in the middle of the map's setup.
      if (!environment) attachEnvironment(renderer);

      // The drawn length follows the zoom, so the scale is refreshed whenever
      // the map resolution moves more than a fraction of a percent.
      if (map) {
        const next = metresPerPixel(map);
        if (Math.abs(next - metresPerPixelValue) > metresPerPixelValue * 0.002) {
          metresPerPixelValue = next;
          for (const node of nodes.values()) placeNode(node, node.boat, next);
        }
      }

      camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix);
      renderer.resetState();
      renderer.render(scene, camera);
    },

    onRemove() {
      for (const node of nodes.values()) {
        node.wakeMaterial.dispose();
        node.bracketMaterial.dispose();
        node.brackets.geometry.dispose();
        node.labelMaterial.dispose();
        node.labelTexture.dispose();
      }
      nodes.clear();
      fleetRoot.clear();
      environment?.dispose();
      environment = null;
      renderer = null;
      map = null;
    },
  };
}
