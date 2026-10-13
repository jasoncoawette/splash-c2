import mapboxgl, { type Map as MapboxMap } from "mapbox-gl";
import type { Position } from "../../core/types";
import { clampToWater } from "../../core/seaRoom.ts";
import { ringCoordinates } from "./perimeterLayer";

/**
 * THE OBJECTIVE AREA
 *
 * One colour owns the objective. The pin, the ground it covers, the legs the
 * fleet flies around it and the nodes those legs turn on are all drawn in the
 * same orange, so "this belongs to the objective" is read off the chart rather
 * than off a label. Everything the chart merely *reports* — depth, seamarks,
 * traffic, our own hulls — stays in its own palette.
 *
 * The area itself was until now invisible: `command.radiusNm` planned the
 * patrol but was never projected, so the only evidence of how much water an
 * objective claimed was the shape of the route that came back. This draws it.
 */

/** The objective orange, per theme. Light needs it darker to survive paper. */
export const OBJECTIVE_ORANGE = {
  DARK: "#ff8718",
  LIGHT: "#c0590a",
} as const;

/**
 * The night basemap lights what it draws, and anything that does not opt out is
 * multiplied down with the rest of the scene — which turned this orange into a
 * dark brown while the pin, a DOM marker outside the lighting, stayed true. The
 * objective is an instruction, not terrain, so it lights itself: full emissive
 * at night, none by day, where the scene is already bright.
 */
export function emissive(theme: "DARK" | "LIGHT"): number {
  return theme === "LIGHT" ? 0 : 1;
}

export const OBJECTIVE_AREA_SOURCE = "splash-objective-area";
export const OBJECTIVE_AREA_FILL = "splash-objective-area-fill";
export const OBJECTIVE_AREA_LINE = "splash-objective-area-line";
export const OBJECTIVE_AREA_LEADERS = "splash-objective-area-leaders";

export interface ObjectiveArea {
  center: Position;
  radiusNm: number;
  /** Where the tasked hulls are, so each can be tied back to the objective. */
  tasked: readonly Position[];
}

function areaData(area: ObjectiveArea | null) {
  if (!area) return { type: "FeatureCollection" as const, features: [] };

  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: { kind: "area" },
        geometry: {
          type: "Polygon" as const,
          coordinates: [ringCoordinates(area.center, area.radiusNm)],
        },
      },
      // A leader per tasked hull. The route already runs to the objective, but
      // it runs the long way round; this is the straight answer to "who is this
      // objective's?", which a dashed hairline can give without being read as a
      // course to steer.
      //
      // Clipped at the water's edge all the same. A leader is not a course, but
      // a line drawn across a wharf reads as one, and nothing on this chart
      // should be seen crossing land.
      ...area.tasked.map((hull) => {
        const reach = clampToWater(hull, area.center);

        return {
          type: "Feature" as const,
          properties: { kind: "leader" },
          geometry: {
            type: "LineString" as const,
            coordinates: [
              [hull.longitude, hull.latitude],
              [reach.longitude, reach.latitude],
            ],
          },
        };
      }),
    ],
  };
}

export function addObjectiveAreaLayers(map: MapboxMap): void {
  if (map.getSource(OBJECTIVE_AREA_SOURCE)) return;

  map.addSource(OBJECTIVE_AREA_SOURCE, { type: "geojson", data: areaData(null) });

  map.addLayer({
    id: OBJECTIVE_AREA_FILL,
    type: "fill",
    slot: "top",
    source: OBJECTIVE_AREA_SOURCE,
    filter: ["==", ["get", "kind"], "area"],
    paint: {
      "fill-color": OBJECTIVE_ORANGE.DARK,
      // Faint enough to read depth and berths through, present enough that the
      // objective's reach is never a guess.
      "fill-opacity": 0.08,
      "fill-emissive-strength": emissive("DARK"),
    },
  });

  map.addLayer({
    id: OBJECTIVE_AREA_LEADERS,
    type: "line",
    slot: "top",
    source: OBJECTIVE_AREA_SOURCE,
    filter: ["==", ["get", "kind"], "leader"],
    layout: { "line-cap": "round" },
    paint: {
      "line-color": OBJECTIVE_ORANGE.DARK,
      "line-width": 1,
      "line-opacity": 0.3,
      "line-dasharray": [1, 3],
      "line-emissive-strength": emissive("DARK"),
    },
  });

  map.addLayer({
    id: OBJECTIVE_AREA_LINE,
    type: "line",
    slot: "top",
    source: OBJECTIVE_AREA_SOURCE,
    filter: ["==", ["get", "kind"], "area"],
    layout: { "line-join": "round" },
    paint: {
      "line-color": OBJECTIVE_ORANGE.DARK,
      // Dashed, where a raised perimeter is solid: this ring is the plan's
      // reach, not an instruction anyone is holding.
      "line-dasharray": [3, 2.4],
      "line-width": 1.6,
      "line-opacity": 0.7,
      "line-emissive-strength": emissive("DARK"),
    },
  });
}

export interface ObjectiveAreaOverlay {
  setArea: (area: ObjectiveArea | null) => void;
  setTheme: (theme: "DARK" | "LIGHT") => void;
  destroy: () => void;
}

/**
 * Hover is painted straight onto the layers rather than through `feature-state`.
 * The area is a single feature that is rebuilt whenever the objective moves or
 * the radius changes, and feature state does not survive a `setData` — it would
 * drop the highlight out from under a pointer that never left.
 */
export function createObjectiveArea(host: {
  map: MapboxMap;
  theme: "DARK" | "LIGHT";
}): ObjectiveAreaOverlay {
  const { map } = host;
  let theme: "DARK" | "LIGHT" = host.theme;
  let area: ObjectiveArea | null = null;
  let hovered = false;

  const tip = new mapboxgl.Popup({
    className: "objective-tip",
    closeButton: false,
    closeOnClick: false,
    closeOnMove: false,
    // The pointer is already on the thing being described, so the tip sits
    // clear of it rather than under the cursor.
    offset: 14,
    maxWidth: "none",
  });

  function paint() {
    if (!map.getLayer(OBJECTIVE_AREA_FILL)) return;

    const orange = OBJECTIVE_ORANGE[theme];
    const lit = emissive(theme);

    map.setPaintProperty(OBJECTIVE_AREA_FILL, "fill-color", orange);
    map.setPaintProperty(OBJECTIVE_AREA_FILL, "fill-opacity", hovered ? 0.2 : 0.08);
    map.setPaintProperty(OBJECTIVE_AREA_FILL, "fill-emissive-strength", lit);
    map.setPaintProperty(OBJECTIVE_AREA_LINE, "line-color", orange);
    map.setPaintProperty(OBJECTIVE_AREA_LINE, "line-width", hovered ? 2.8 : 1.6);
    map.setPaintProperty(OBJECTIVE_AREA_LINE, "line-opacity", hovered ? 1 : 0.7);
    map.setPaintProperty(OBJECTIVE_AREA_LINE, "line-emissive-strength", lit);
    map.setPaintProperty(OBJECTIVE_AREA_LEADERS, "line-color", orange);
    map.setPaintProperty(OBJECTIVE_AREA_LEADERS, "line-opacity", hovered ? 0.8 : 0.3);
    map.setPaintProperty(OBJECTIVE_AREA_LEADERS, "line-emissive-strength", lit);
  }

  function publish() {
    const source = map.getSource(OBJECTIVE_AREA_SOURCE);
    if (source && "setData" in source) {
      (source as mapboxgl.GeoJSONSource).setData(areaData(area));
    }
  }

  function tipHtml(current: ObjectiveArea) {
    const tasked = current.tasked.length;
    return [
      '<span class="objective-tip-title">Objective area</span>',
      `<span class="objective-tip-line">${current.radiusNm.toFixed(1)} NM radius</span>`,
      `<span class="objective-tip-line">${tasked} ${tasked === 1 ? "vessel" : "vessels"} tasked</span>`,
    ].join("");
  }

  const onMove = (event: mapboxgl.MapMouseEvent) => {
    if (!area) return;

    if (!hovered) {
      hovered = true;
      paint();
    }

    tip.setLngLat(event.lngLat).setHTML(tipHtml(area)).addTo(map);
  };

  const onLeave = () => {
    if (!hovered) return;
    hovered = false;
    paint();
    tip.remove();
  };

  // A style swap drops every source the app added, so the layers are rebuilt
  // and the current area republished rather than waiting on the next change.
  const onStyle = () => {
    addObjectiveAreaLayers(map);
    publish();
    paint();
  };

  // A remount lands on a style that is already up; a cold start is served by
  // the `style.load` below, which fires after this because the map is new.
  if (map.isStyleLoaded()) {
    addObjectiveAreaLayers(map);
    paint();
  }

  map.on("style.load", onStyle);
  map.on("mousemove", OBJECTIVE_AREA_FILL, onMove);
  map.on("mouseleave", OBJECTIVE_AREA_FILL, onLeave);

  return {
    setArea(next) {
      area = next;
      publish();
      if (!next) onLeave();
    },

    setTheme(next) {
      theme = next;
      paint();
    },

    destroy() {
      map.off("style.load", onStyle);
      map.off("mousemove", OBJECTIVE_AREA_FILL, onMove);
      map.off("mouseleave", OBJECTIVE_AREA_FILL, onLeave);
      tip.remove();
    },
  };
}
