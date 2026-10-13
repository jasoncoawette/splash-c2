import type { Map as MapboxMap } from "mapbox-gl";
import { styleHasGlyphs } from "./seascape";

/**
 * OPEN WATERS CHART AND TRAFFIC
 *
 * Two vector tile services from openwaters.io, neither of which needs a key:
 *
 *   Seamap  — seamarks, lights, hazards and sea areas, rebuilt weekly from
 *             OpenStreetMap. This is the "sea indicators" layer.
 *   AIS     — live vessel positions by tile, rebuilt at most every 10 seconds.
 *
 * Both are CC-BY and both carry a not-for-navigation caveat, which is why the
 * requirement ledger keeps them as context rather than as collision truth.
 */

export const SEAMAP_TILEJSON = "https://tiles.openwaters.io/seamap/tiles.json";
export const AIS_TILEJSON = "https://ais.openwaters.io/v1/vessels/tiles.json";

export const SEAMAP_SOURCE = "openwaters-seamap";
export const AIS_SOURCE = "openwaters-ais";
export const AIS_SOURCE_LAYER = "vessels";

/** The service rebuilds tiles every 10s; refreshing faster only costs quota. */
export const AIS_REFRESH_MS = 15_000;

export const AIS_LAYERS = {
  /** Invisible, generous, and first in the query: what a click actually hits. */
  hit: "openwaters-ais-hit",
  hull: "openwaters-ais-hull",
  underway: "openwaters-ais-underway",
  label: "openwaters-ais-label",
  target: "openwaters-ais-target",
} as const;

export type ChartTheme = "DARK" | "LIGHT";

const ACCENT = "#52cbff";
const TRAFFIC = "#e3a765";
const TRAFFIC_DIM = "rgba(227, 167, 101, 0.55)";

/**
 * CHART INK, PER PAPER
 *
 * Every colour these layers draw with, held in one place and in both themes.
 * They used to be written into the layer definitions, which meant the chart was
 * painted once, at the first style load, in whichever theme happened to be on:
 * toggling to day left seamarks outlined in near-black and traffic names haloed
 * in it, which is what made light mode read as a dark chart with the lights
 * turned up. `setOpenWatersTheme` repaints the lot, and the theme effect calls
 * it on every toggle and every style reload.
 */
const CHART_INK = {
  DARK: {
    seaArea: "#0c1d26",
    seaAreaOpacity: 0.35,
    waterway: "#2b5468",
    waterwayOpacity: 0.5,
    seamark: ACCENT,
    seamarkHazard: "#ff8a8a",
    seamarkStroke: "rgba(7, 16, 21, 0.8)",
    lightGlow: "#ffe9b0",
    lightOpacity: 0.3,
    traffic: TRAFFIC,
    trafficLabel: TRAFFIC_DIM,
    trafficHalo: "rgba(4, 11, 15, 0.9)",
    target: ACCENT,
  },
  LIGHT: {
    // Day water is pale, so the sea-area wash has to come down from the other
    // side: a blue tint, not a dark one.
    seaArea: "#9fc4d8",
    seaAreaOpacity: 0.22,
    waterway: "#3f7f9e",
    waterwayOpacity: 0.65,
    seamark: "#0d7fb8",
    seamarkHazard: "#b3261e",
    seamarkStroke: "rgba(255, 255, 255, 0.92)",
    lightGlow: "#e09a2c",
    lightOpacity: 0.42,
    // Traffic keeps its hue and loses its brightness: a pale orange on white
    // paper is nothing at all.
    traffic: "#b4631a",
    trafficLabel: "#7d4310",
    trafficHalo: "rgba(255, 255, 255, 0.95)",
    target: "#0d7fb8",
  },
} as const;

/** One icon per theme, because the arrowhead is outlined in the paper colour. */
export function contactIconId(theme: ChartTheme): string {
  return theme === "LIGHT" ? "ow-contact-light" : "ow-contact-dark";
}

/**
 * Seamarks and depth, drawn under everything the operator owns.
 *
 * Ordering is by SLOT, not by `beforeId`. These layers declare slot "middle",
 * and Mapbox refuses to rearrange a layer relative to one in a different slot —
 * passing a basemap symbol layer as `beforeId` here produced a console warning
 * and no reordering, because the two live in different slots.
 */
export function addSeamapLayers(map: MapboxMap): void {
  if (map.getSource(SEAMAP_SOURCE)) return;

  map.addSource(SEAMAP_SOURCE, { type: "vector", url: SEAMAP_TILEJSON });

  map.addLayer({
    id: "openwaters-sea-area",
    slot: "middle",
    type: "fill",
    source: SEAMAP_SOURCE,
    "source-layer": "sea_area",
    paint: {
      "fill-color": "#0c1d26",
      "fill-opacity": 0.35,
    },
  });

  map.addLayer({
    id: "openwaters-waterway",
    slot: "middle",
    type: "line",
    source: SEAMAP_SOURCE,
    "source-layer": "waterway",
    paint: {
      "line-color": "#2b5468",
      "line-width": 0.8,
      "line-opacity": 0.5,
    },
  });

  // Seamarks: buoys, beacons, wrecks, rocks and restricted areas.
  map.addLayer({
    id: "openwaters-seamark",
    slot: "middle",
    type: "circle",
    source: SEAMAP_SOURCE,
    "source-layer": "seamark",
    minzoom: 9,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 1.6, 15, 4],
      "circle-color": [
        "match",
        ["get", "category"],
        "wreck", "#ff8a8a",
        "rock", "#ff8a8a",
        "obstruction", "#ff8a8a",
        ACCENT,
      ],
      "circle-opacity": 0.75,
      "circle-stroke-color": "rgba(7, 16, 21, 0.8)",
      "circle-stroke-width": 0.6,
    },
  });

  // Lights get a halo, because at night they are the thing an operator looks for.
  map.addLayer({
    id: "openwaters-light",
    slot: "middle",
    type: "circle",
    source: SEAMAP_SOURCE,
    "source-layer": "light",
    minzoom: 8,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 15, 7],
      "circle-color": "#ffe9b0",
      "circle-opacity": 0.3,
      "circle-blur": 0.9,
    },
  });
}

/**
 * Live traffic. Drawn as a triangle rotated to each contact's heading, dimmed
 * when the report is stale, so a contact that stopped reporting reads as old
 * rather than as present.
 */
export function addAisLayers(map: MapboxMap): void {
  if (map.getSource(AIS_SOURCE)) return;

  map.addSource(AIS_SOURCE, { type: "vector", url: AIS_TILEJSON });

  // A contact is an 11-pixel arrowhead. Asking an operator to hit that with a
  // single click, on a moving target, is the whole reason traffic used to need
  // a list in the panel. This layer is the click target: transparent, never
  // drawn, and wide enough to catch the press that was meant for the hull.
  map.addLayer({
    id: AIS_LAYERS.hit,
    type: "circle",
    source: AIS_SOURCE,
    "source-layer": AIS_SOURCE_LAYER,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 9, 13, 15, 16, 22],
      "circle-color": "rgba(0, 0, 0, 0)",
    },
  });

  map.addLayer({
    id: AIS_LAYERS.hull,
    type: "symbol",
    source: AIS_SOURCE,
    "source-layer": AIS_SOURCE_LAYER,
    layout: {
      "icon-image": contactIconId("DARK"),
      "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 15, 1],
      "icon-rotate": ["coalesce", ["get", "hdg"], ["get", "cog"], 0],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
    },
    paint: {
      "icon-opacity": ["case", [">", ["coalesce", ["get", "age_s"], 0], 600], 0.3, 0.95],
    },
  });

  // A wake stub on anything actually making way, so movement reads at a glance.
  map.addLayer({
    id: AIS_LAYERS.underway,
    type: "circle",
    source: AIS_SOURCE,
    "source-layer": AIS_SOURCE_LAYER,
    filter: [">", ["coalesce", ["get", "sog"], 0], 0.5],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 5, 15, 14],
      "circle-color": TRAFFIC,
      "circle-opacity": 0.09,
      "circle-blur": 0.8,
    },
  });

  // The contact an order is pointed at. Filtered to nothing until one is picked.
  map.addLayer({
    id: AIS_LAYERS.target,
    type: "circle",
    source: AIS_SOURCE,
    "source-layer": AIS_SOURCE_LAYER,
    filter: ["==", ["get", "mmsi"], -1],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 10, 15, 26],
      "circle-color": "rgba(0, 0, 0, 0)",
      "circle-stroke-color": ACCENT,
      "circle-stroke-width": 1.6,
      "circle-stroke-opacity": 0.9,
    },
  });

  // Names are text; without a glyph endpoint the style refuses the layer and
  // the hulls go on being drawn without it.
  if (!styleHasGlyphs(map)) return;

  map.addLayer({
    id: AIS_LAYERS.label,
    type: "symbol",
    source: AIS_SOURCE,
    "source-layer": AIS_SOURCE_LAYER,
    minzoom: 12,
    // A busy port labels into noise. Name the traffic that is actually making
    // way or big enough to matter; the rest still draw as contacts.
    filter: ["any",
      [">", ["coalesce", ["get", "sog"], 0], 0.5],
      [">", ["coalesce", ["get", "length"], 0], 50],
    ],
    layout: {
      "text-field": ["coalesce", ["get", "name"], ["to-string", ["get", "mmsi"]]],
      "text-size": 10,
      "text-offset": [0, 1.3],
      "text-anchor": "top",
      "text-allow-overlap": false,
      "text-letter-spacing": 0.08,
    },
    paint: {
      "text-color": TRAFFIC_DIM,
      "text-halo-color": "rgba(4, 11, 15, 0.9)",
      "text-halo-width": 1.1,
    },
  });
}

/** The arrowhead, one per theme, registered once per map. */
export function addContactIcon(map: MapboxMap): void {
  for (const theme of ["DARK", "LIGHT"] as const) {
    const id = contactIconId(theme);
    if (map.hasImage(id)) continue;

    const size = 32;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");

    if (!context) return;

    context.beginPath();
    context.moveTo(size / 2, 3);
    context.lineTo(size - 7, size - 5);
    context.lineTo(size / 2, size - 11);
    context.lineTo(7, size - 5);
    context.closePath();
    context.fillStyle = CHART_INK[theme].traffic;
    context.fill();
    context.lineWidth = 1.5;
    // The outline is the paper, so the hull keeps an edge on either chart.
    context.strokeStyle = theme === "LIGHT"
      ? "rgba(255, 255, 255, 0.9)"
      : "rgba(4, 11, 15, 0.85)";
    context.stroke();

    map.addImage(id, context.getImageData(0, 0, size, size), { pixelRatio: 2 });
  }
}

/**
 * Repaint every Open Waters layer for the theme on the screen. Safe to call on
 * a map that has not loaded them yet: each layer is checked before it is
 * touched, so a style still swapping simply gets the pass again on style.load.
 */
export function setOpenWatersTheme(map: MapboxMap, theme: ChartTheme): void {
  const ink = CHART_INK[theme];

  if (map.getLayer("openwaters-sea-area")) {
    map.setPaintProperty("openwaters-sea-area", "fill-color", ink.seaArea);
    map.setPaintProperty("openwaters-sea-area", "fill-opacity", ink.seaAreaOpacity);
  }

  if (map.getLayer("openwaters-waterway")) {
    map.setPaintProperty("openwaters-waterway", "line-color", ink.waterway);
    map.setPaintProperty("openwaters-waterway", "line-opacity", ink.waterwayOpacity);
  }

  if (map.getLayer("openwaters-seamark")) {
    map.setPaintProperty("openwaters-seamark", "circle-color", [
      "match",
      ["get", "category"],
      "wreck", ink.seamarkHazard,
      "rock", ink.seamarkHazard,
      "obstruction", ink.seamarkHazard,
      ink.seamark,
    ]);
    map.setPaintProperty("openwaters-seamark", "circle-stroke-color", ink.seamarkStroke);
  }

  if (map.getLayer("openwaters-light")) {
    map.setPaintProperty("openwaters-light", "circle-color", ink.lightGlow);
    map.setPaintProperty("openwaters-light", "circle-opacity", ink.lightOpacity);
  }

  if (map.getLayer(AIS_LAYERS.hull) && map.hasImage(contactIconId(theme))) {
    map.setLayoutProperty(AIS_LAYERS.hull, "icon-image", contactIconId(theme));
  }

  if (map.getLayer(AIS_LAYERS.underway)) {
    map.setPaintProperty(AIS_LAYERS.underway, "circle-color", ink.traffic);
    map.setPaintProperty(AIS_LAYERS.underway, "circle-opacity", theme === "LIGHT" ? 0.14 : 0.09);
  }

  if (map.getLayer(AIS_LAYERS.target)) {
    map.setPaintProperty(AIS_LAYERS.target, "circle-stroke-color", ink.target);
  }

  // The names are the part that read as broken: dim orange haloed in near-black
  // over a white harbour.
  if (map.getLayer(AIS_LAYERS.label)) {
    map.setPaintProperty(AIS_LAYERS.label, "text-color", ink.trafficLabel);
    map.setPaintProperty(AIS_LAYERS.label, "text-halo-color", ink.trafficHalo);
    map.setPaintProperty(AIS_LAYERS.label, "text-halo-width", theme === "LIGHT" ? 1.4 : 1.1);
  }
}

export interface AisContact {
  mmsi: number;
  name: string;
  longitude: number;
  latitude: number;
  headingDegrees: number;
  speedKnots: number;
  kind: string;
  lengthM: number | null;
  ageSeconds: number;
}

/**
 * Read the contacts the loaded tiles carry. The tiles are the source of truth
 * for what is on screen, so tasking reads the same data the operator is looking
 * at rather than a second copy fetched separately. A vessel can appear in more
 * than one tile, hence the dedupe by MMSI.
 */
export function readAisContacts(map: MapboxMap): AisContact[] {
  if (!map.getSource(AIS_SOURCE)) return [];

  const seen = new Map<number, AisContact>();

  for (const feature of map.querySourceFeatures(AIS_SOURCE, {
    sourceLayer: AIS_SOURCE_LAYER,
  })) {
    const properties = feature.properties ?? {};
    const mmsi = Number(properties.mmsi);

    if (!Number.isFinite(mmsi) || seen.has(mmsi)) continue;
    if (feature.geometry.type !== "Point") continue;

    const [longitude, latitude] = feature.geometry.coordinates as [number, number];

    seen.set(mmsi, {
      mmsi,
      name: typeof properties.name === "string" && properties.name.trim().length > 0
        ? properties.name
        : `MMSI ${mmsi}`,
      longitude,
      latitude,
      headingDegrees: Number(properties.hdg ?? properties.heading ?? properties.cog ?? 0),
      speedKnots: Number(properties.sog ?? 0),
      kind: typeof properties.kind === "string" ? properties.kind : "vessel",
      lengthM: Number.isFinite(Number(properties.length)) ? Number(properties.length) : null,
      ageSeconds: Number(properties.age_s ?? 0),
    });
  }

  return [...seen.values()].sort((first, second) => first.mmsi - second.mmsi);
}
