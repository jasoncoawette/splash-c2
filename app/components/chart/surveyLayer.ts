import type { Map as MapboxMap } from "mapbox-gl";
import type { GeoJSON } from "geojson";
import {
  boundsOf,
  cellOfKey,
  cellsWithin,
  keyOf,
  ringOf,
  type CellKey,
} from "../../core/surveyGrid.ts";

// SURVEY SQUARES ON THE CHART
//
// Two things are drawn: the candidate grid, shown only while the survey tool is
// in hand, and the squares already chosen, which stay visible whatever tool is
// active — a marked search area is a standing fact about the mission, not a
// property of the tool that made it.

export const SURVEY_SOURCE = "splash-survey";
export const SURVEY_GRID_SOURCE = "splash-survey-grid";
export const SURVEY_FILL = "splash-survey-fill";
export const SURVEY_LINE = "splash-survey-line";
export const SURVEY_GRID_LINE = "splash-survey-grid-line";

export const SURVEY_LAYERS = [SURVEY_FILL, SURVEY_LINE, SURVEY_GRID_LINE] as const;

function polygons(keys: readonly CellKey[], sizeNm: number): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: keys.map((key) => ({
      type: "Feature",
      properties: { key },
      geometry: { type: "Polygon", coordinates: [ringOf(cellOfKey(key), sizeNm)] },
    })),
  };
}

export function surveyData(
  keys: readonly CellKey[],
  sizeNm: number,
): GeoJSON.FeatureCollection {
  return polygons(keys, sizeNm);
}

/**
 * The grid covering a viewport, minus the squares already chosen so the two
 * layers never paint the same outline twice.
 */
export function surveyGridData(
  bounds: { west: number; east: number; south: number; north: number },
  chosen: readonly CellKey[],
  sizeNm: number,
): GeoJSON.FeatureCollection {
  const taken = new Set(chosen);
  const keys = cellsWithin(bounds, sizeNm)
    .map(keyOf)
    .filter((key) => !taken.has(key));

  return polygons(keys, sizeNm);
}

export function addSurveyLayers(map: MapboxMap): void {
  if (map.getSource(SURVEY_SOURCE)) return;

  map.addSource(SURVEY_SOURCE, { type: "geojson", data: polygons([], 0.5) });
  map.addSource(SURVEY_GRID_SOURCE, { type: "geojson", data: polygons([], 0.5) });

  // The candidate grid: hairlines, and nothing else, so it reads as graph paper
  // rather than as another thing drawn on the water.
  map.addLayer({
    id: SURVEY_GRID_LINE,
    type: "line",
    slot: "top",
    source: SURVEY_GRID_SOURCE,
    layout: { visibility: "none" },
    paint: {
      // Quiet, but not invisible. At 0.6 px and 0.22 alpha this rendered as
      // nothing at all on a busy chart — the same mistake the isobaths made.
      "line-color": "#9ef0ff",
      "line-width": 1,
      "line-opacity": 0.45,
    },
  });

  map.addLayer({
    id: SURVEY_FILL,
    type: "fill",
    slot: "top",
    source: SURVEY_SOURCE,
    paint: {
      "fill-color": "#52cbff",
      "fill-opacity": 0.26,
    },
  });

  map.addLayer({
    id: SURVEY_LINE,
    type: "line",
    slot: "top",
    source: SURVEY_SOURCE,
    paint: {
      "line-color": "#bff2ff",
      "line-width": 1.8,
      "line-opacity": 0.95,
    },
  });
}

/** Every chosen square's extent, for framing or for planning a sweep over them. */
export function surveyBounds(keys: readonly CellKey[], sizeNm: number) {
  if (keys.length === 0) return null;

  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;

  for (const key of keys) {
    const box = boundsOf(cellOfKey(key), sizeNm);
    west = Math.min(west, box.west);
    east = Math.max(east, box.east);
    south = Math.min(south, box.south);
    north = Math.max(north, box.north);
  }

  return { west, east, south, north };
}
