import type mapboxgl from "mapbox-gl";
import type { Map as MapboxMap } from "mapbox-gl";

/**
 * THE CHART'S WATER
 *
 * Depth, relief and the day/night ground under both of them. This lived inside
 * FleetMap, which meant exactly one view could draw it: the helm's corner chart
 * showed seamarks on a bare basemap, so the moment an operator took a boat the
 * depth they had been reading disappeared. One module, two charts, one answer
 * about what the water is doing.
 */

/**
 * Whether this style can draw text at all.
 *
 * A symbol layer with a `text-field` on a style that publishes no glyph
 * endpoint is rejected outright, once per layer, per style load — and with
 * nothing listening on the map's error event those rejections went to the
 * console as untraceable stack traces from the GL worker. The token-less
 * fallback style is exactly that style, so the chart asks before it writes.
 *
 * Two places can answer yes. A plain style carries `glyphs` itself. Standard
 * carries none at the root and serves them from the fragment it imports, which
 * is why this cannot simply read `style.glyphs`: doing that silently dropped
 * every sounding and isobath label from both charts while reporting nothing.
 */
export function styleHasGlyphs(map: MapboxMap): boolean {
  try {
    const style = map.getStyle();
    if (!style) return false;

    return Boolean(style.glyphs) || (style.imports?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

export type ChartTheme = "DARK" | "LIGHT";

// OPEN WATERS SEASCAPE
//
// Depth context under the fleet: isobaths, spot soundings and depth-area
// shading from Open Waters' open bathymetry compilation. No key is required and
// the attribution is carried in the TileJSON, so Mapbox's attribution control
// picks it up on its own.
//
// This is context, never truth. Open Waters say it plainly and the requirement
// ledger says the same: depths here are not reduced to a chart datum and take
// no account of tide, so they are not charted depths and nothing may treat them
// as a collision rule. The readout prints that alongside the toggle.
// Seafloor relief is NOT drawn, and the reason is worth keeping: Mapbox GL
// cannot decode Open Waters' DEM. The tiles are terrarium-encoded WebP, and a
// `raster-dem` source pointed at them reports loaded, raises no error, and
// paints nothing — proved with absurd highlight colours and with every layer
// above it hidden. The same hillshade layer against a PNG terrarium source
// (AWS elevation-tiles-prod) paints immediately, so the blocker is the WebP
// container, not the encoding, the layer type or the data.
//
// The data itself is good: these tiles carry real soundings, about -20 m across
// the inner harbour and -1320 m out past Catalina.
//
// Drawing it would mean decoding the WebP and shading it ourselves in a custom
// layer. Until then the seafloor is carried by contours and soundings, which
// are surveyed depths and not relief, and must not be described as relief.
export const SEASCAPE_SOURCE = "seascape";
const SEASCAPE_TILEJSON = "https://tiles.openwaters.io/seascape/vector.json";

export const SEASCAPE_LAYERS = [
  "seascape-depth-areas",
  "seascape-contours",
  "seascape-contour-labels",
  "seascape-soundings",
] as const;

/** An isobath at a round ten metres reads as an index contour. */
function isIndexContour(onIndex: number, otherwise: number) {
  return [
    "case",
    ["==", ["%", ["abs", ["coalesce", ["get", "depth_m"], 1]], 10], 0],
    onIndex,
    otherwise,
  ] as unknown as mapboxgl.ExpressionSpecification;
}


/** Shallow reads bright, deep reads dim, so depth is legible without labels. */
function contourRamp(light: boolean): mapboxgl.ExpressionSpecification {
  const stops = light
    ? ["#0f4a68", "#1d6b8f", "#3f8cb0", "#6aa9c6"]
    : ["#7fd0ec", "#5fb0d4", "#4089b0", "#2a5f85"];

  return [
    "interpolate", ["linear"], ["abs", ["coalesce", ["get", "depth_m"], 0]],
    0, stops[0],
    10, stops[1],
    25, stops[2],
    60, stops[3],
  ];
}
const SOUNDING_COLOUR = { DARK: "#b4ecff", LIGHT: "#12546d" } as const;

/**
 * The day basemap's ground.
 *
 * Two things decide what these do. The basemap runs the monochrome theme, so
 * the hue in them is thrown away and only the lightness survives — a loud
 * magenta and a pale grey of the same lightness render identically, which was
 * worth proving before trusting any of these numbers. And Mapbox lights the
 * scene after reading them, so each is picked a shade under where it should
 * land: LIGHT_LAND renders at roughly neutral-50, which leaves the white panels
 * and the white tool rails as the brightest things on the screen.
 *
 * Every land class gets the same lightness on purpose. The port is zoned
 * commercial and industrial in places and the basemap gives each its own tone,
 * which on a chart reads as three kinds of ground where there is one shore.
 * The day sun's own warmth still sits over all of it; that belongs to the
 * light preset, not to the palette, and is not ours to argue with.
 */
const LIGHT_LAND = "hsl(210, 9%, 90%)";
const LIGHT_BUILDING = "hsl(210, 11%, 86%)";
const LIGHT_GREENSPACE = "hsl(140, 14%, 88%)";
const LIGHT_COMMERCIAL = "hsl(210, 9%, 90%)";
const LIGHT_INDUSTRIAL = "hsl(210, 9%, 90%)";

/**
 * The Standard schema's own defaults for the same properties. Night needs them
 * back: `setConfigProperty` has no "unset", so restoring means writing the
 * published default rather than passing undefined, which the style refuses.
 */
const BASEMAP_LAND = "hsl(20, 20%, 95%)";
const BASEMAP_BUILDING = "hsl(40, 43%, 93%)";
const BASEMAP_GREENSPACE = "hsl(115, 60%, 84%)";
const BASEMAP_COMMERCIAL = "hsla(24, 100%, 94%, 1)";
const BASEMAP_INDUSTRIAL = "hsl(230, 15%, 92%)";
const BASEMAP_ROAD_BRIGHTNESS = 0.4;

/**
 * Shallow reads bright and deep reads dark either way, but which end of the
 * scale that is depends on the paper. The dark ramp holds a FLOOR well above
 * the basemap's water: running it down into near-black was the original
 * intent and it was wrong, because the night basemap's water is already
 * near-black and the deepest bands simply disappeared into it. The day ramp
 * runs the way a chart is actually printed, pale shallows into blue.
 *
 * Without the light ramp the land turned white underneath and the water stayed
 * navy, which is what made the theme toggle look broken.
 */
function depthRamp(light: boolean): mapboxgl.ExpressionSpecification {
  const stops = light
    ? ["#e8f4fb", "#d0e7f4", "#b2d6ec", "#8fc1e0", "#67a3cd"]
    // The night basemap's water is already near-black, so a ramp that runs
    // down into near-black loses its deepest two thirds to the background.
    // The deep end holds a floor above the basemap instead: every band stays a
    // visible band, and depth reads as a gradient rather than as nothing.
    : ["#2b6f90", "#235a77", "#1c475f", "#163849", "#112b38"];

  return [
    "interpolate", ["linear"], ["coalesce", ["get", "drval1"], 0],
    0, stops[0],
    5, stops[1],
    10, stops[2],
    20, stops[3],
    50, stops[4],
  ] as unknown as mapboxgl.ExpressionSpecification;
}

export const TERRAIN_SOURCE = "mapbox-terrain-dem";
export const TERRAIN_LAYER = "mapbox-terrain-hillshade";

/**
 * Relief from Mapbox's own DEM. Open Waters ships a terrarium `.webp` DEM for
 * MapLibre, which never painted here; the basemap's DEM is the one this style
 * and this token are already set up for.
 */
export function addTerrain(map: MapboxMap): void {
  if (map.getSource(TERRAIN_SOURCE)) return;

  map.addSource(TERRAIN_SOURCE, {
    type: "raster-dem",
    url: "mapbox://mapbox.mapbox-terrain-dem-v1",
    tileSize: 512,
  });

  map.addLayer({
    id: TERRAIN_LAYER,
    type: "hillshade",
    slot: "middle",
    source: TERRAIN_SOURCE,
    paint: {
      "hillshade-shadow-color": "#01060a",
      "hillshade-highlight-color": "#5fa9cc",
      "hillshade-accent-color": "#10384d",
      "hillshade-exaggeration": 0.65,
    },
  });
}

/**
 * The same DEM, actually in three dimensions.
 *
 * `addTerrain` above paints a hillshade: shading on a surface that stays flat.
 * That is right for a chart looked at from overhead, and wrong for a camera
 * sitting on the water — tilt a flat map to 85 degrees and the horizon is a
 * dead straight line with no land standing on it.
 *
 * `setTerrain` displaces the map surface by the elevation in the same source,
 * so a pitched camera sees the shore rise and occlude what is behind it. No
 * extra data: this is the DEM `addTerrain` already added.
 */
export function setTerrainRelief(map: MapboxMap, exaggeration: number): void {
  if (!map.getSource(TERRAIN_SOURCE)) return;

  map.setTerrain({ source: TERRAIN_SOURCE, exaggeration });
}

export function addSeascape(map: MapboxMap): void {
  if (map.getSource(SEASCAPE_SOURCE)) return;

  map.addSource(SEASCAPE_SOURCE, { type: "vector", url: SEASCAPE_TILEJSON });


  // Shallow water reads brighter, so the shelf and the channel separate at a
  // glance. drval1 is the shoal limit of each depth area, in metres.
  map.addLayer({
    id: "seascape-depth-areas",
    slot: "middle",
    type: "fill",
    source: SEASCAPE_SOURCE,
    "source-layer": "depare",
    paint: {
      "fill-color": depthRamp(false),
      "fill-opacity": 0.5,
      // Standard lights layers in its slots, and the night preset's ambient is
      // low enough to crush a mid-blue fill to near-black. Emissive strength
      // makes the chart emit its own colour instead of being lit by the scene,
      // which is why dark mode read as flat water while light mode was fine.
      "fill-emissive-strength": 0.85,
    },
  });

  map.addLayer({
    id: "seascape-contours",
    slot: "middle",
    type: "line",
    source: SEASCAPE_SOURCE,
    "source-layer": "contours",
    filter: [">", ["abs", ["coalesce", ["get", "depth_m"], 0]], 0],
    paint: {
      "line-color": [
        "interpolate", ["linear"], ["abs", ["coalesce", ["get", "depth_m"], 0]],
        0, "#6ec6e8",
        10, "#56a8cf",
        25, "#3b86ad",
        60, "#2b6690",
      ],
      // Round-number isobaths carry the eye; the rest are quiet. Quiet still
      // has to be visible though: at 0.45 px and 0.18 alpha these rendered as
      // nothing at all, and the chart showed depth labels floating with no
      // line under them.
      "line-width": isIndexContour(1.5, 0.85),
      "line-opacity": isIndexContour(0.85, 0.45),
    },
  });

  // Soundings and isobath labels are text, and a style with no glyph endpoint
  // cannot carry text.
  if (!styleHasGlyphs(map)) return;

  map.addLayer({
    id: "seascape-contour-labels",
    slot: "middle",
    type: "symbol",
    source: SEASCAPE_SOURCE,
    "source-layer": "contours",
    minzoom: 12,
    // Index contours only, and never the zero-metre one: the shoreline is
    // already drawn by the basemap, and its line is filtered out above, so a
    // "0 m" label here would float with nothing under it.
    filter: [
      "all",
      [">", ["abs", ["coalesce", ["get", "depth_m"], 0]], 0],
      ["==", ["%", ["abs", ["coalesce", ["get", "depth_m"], 1]], 10], 0],
    ],
    layout: {
      "symbol-placement": "line",
      "text-field": [
        "concat",
        ["to-string", ["abs", ["coalesce", ["get", "depth_m"], 0]]],
        " m",
      ],
      "text-size": 9,
      "text-letter-spacing": 0.08,
      "text-max-angle": 25,
      "symbol-spacing": 220,
    },
    paint: {
      "text-color": SOUNDING_COLOUR.DARK,
      "text-halo-color": "#061016",
      "text-halo-width": 1.2,
      "text-opacity": 0.85,
    },
  });

  map.addLayer({
    id: "seascape-soundings",
    slot: "middle",
    type: "symbol",
    source: SEASCAPE_SOURCE,
    "source-layer": "soundings",
    minzoom: 14.5,
    layout: {
      "text-field": [
        "number-format",
        ["abs", ["coalesce", ["get", "depth_m"], 0]],
        { "max-fractional-digits": 1 },
      ],
      "text-size": 9,
      "text-padding": 14,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": SOUNDING_COLOUR.DARK,
      "text-halo-color": "#061016",
      "text-halo-width": 1,
      "text-opacity": 0.75,
    },
  });
}

/**
 * Repaint depth, relief and soundings for the theme on the screen. Every layer
 * is checked first, so a chart that has not loaded them yet — or a style still
 * swapping — simply takes the pass again on the next `style.load`.
 */
export function setSeascapeTheme(map: MapboxMap, theme: ChartTheme): void {
  const light = theme === "LIGHT";

  if (map.getLayer(TERRAIN_LAYER)) {
    map.setPaintProperty(TERRAIN_LAYER, "hillshade-shadow-color",
      light ? "#8aa7b6" : "#01060a");
    map.setPaintProperty(TERRAIN_LAYER, "hillshade-highlight-color",
      light ? "#ffffff" : "#5fa9cc");
    map.setPaintProperty(TERRAIN_LAYER, "hillshade-accent-color",
      light ? "#c3d6e1" : "#10384d");
    map.setPaintProperty(TERRAIN_LAYER, "hillshade-exaggeration",
      light ? 0.5 : 0.65);
  }

  if (map.getLayer("seascape-depth-areas")) {
    map.setPaintProperty("seascape-depth-areas", "fill-color", depthRamp(light));
    map.setPaintProperty("seascape-depth-areas", "fill-opacity", light ? 0.82 : 0.5);
    map.setPaintProperty("seascape-depth-areas", "fill-emissive-strength", light ? 0 : 0.85);
  }

  if (map.getLayer("seascape-contours")) {
    map.setPaintProperty("seascape-contours", "line-color", contourRamp(light));
    map.setPaintProperty("seascape-contours", "line-emissive-strength", light ? 0 : 0.55);
    map.setPaintProperty("seascape-contours", "line-opacity",
      light ? isIndexContour(0.85, 0.5) : isIndexContour(1, 0.62));
    map.setPaintProperty("seascape-contours", "line-width",
      light ? isIndexContour(1.4, 0.8) : isIndexContour(2.2, 1.15));
  }

  for (const id of ["seascape-contour-labels", "seascape-soundings"] as const) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(id, "text-color",
      light ? SOUNDING_COLOUR.LIGHT : SOUNDING_COLOUR.DARK);
    map.setPaintProperty(id, "text-halo-color", light ? "#f2f7f9" : "#061016");
  }
}

/**
 * The ground the chart sits on, which is the basemap's own and is configured
 * rather than drawn. Called by both charts so land cannot be one colour in the
 * fleet view and another in the corner of the helm.
 *
 * A style without the Standard basemap keeps its own ground: each property is
 * written on its own and a refusal is reported rather than thrown, so one key
 * a style does not publish cannot take the rest of the ground with it.
 */
export function setBasemapTheme(map: MapboxMap, theme: ChartTheme): void {
  const light = theme === "LIGHT";
  const ground: Record<string, string | number> = {
    lightPreset: light ? "day" : "night",
    colorLand: light ? LIGHT_LAND : BASEMAP_LAND,
    colorBuildings: light ? LIGHT_BUILDING : BASEMAP_BUILDING,
    colorGreenspace: light ? LIGHT_GREENSPACE : BASEMAP_GREENSPACE,
    colorCommercial: light ? LIGHT_COMMERCIAL : BASEMAP_COMMERCIAL,
    colorIndustrial: light ? LIGHT_INDUSTRIAL : BASEMAP_INDUSTRIAL,
    roadsBrightness: light ? 0.32 : BASEMAP_ROAD_BRIGHTNESS,
  };

  // One property at a time, and a refusal on one is not allowed to take the
  // rest with it: a single try around the whole set would let the first key a
  // style does not publish skip every property after it.
  const refused: string[] = [];

  for (const [property, value] of Object.entries(ground)) {
    try {
      map.setConfigProperty("basemap", property, value);
    } catch {
      refused.push(property);
    }
  }

  if (refused.length > 0) {
    console.warn("basemap config refused", refused.join(", "));
  }
}
