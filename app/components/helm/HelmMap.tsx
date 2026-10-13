"use client";

import mapboxgl, { type Map as MapboxMap, type StyleSpecification } from "mapbox-gl";
import { useEffect, useRef } from "react";
import type { Mission, Position } from "../../core/types";
import {
  addAisLayers,
  addContactIcon,
  addSeamapLayers,
  AIS_LAYERS,
  AIS_REFRESH_MS,
  AIS_SOURCE,
  setOpenWatersTheme,
} from "../chart/openWaters";
import {
  addSeascape,
  addTerrain,
  setBasemapTheme,
  setSeascapeTheme,
} from "../chart/seascape";
import { attachChartErrors } from "../chart/chartErrors";
import { createObjectiveArea, type ObjectiveAreaOverlay } from "../chart/objectiveArea";
import "./helmStage.css";

const LOCAL_TACTICAL_STYLE: StyleSpecification = {
  version: 8,
  name: "Splash C2 helm water",
  sources: {},
  layers: [
    {
      id: "water",
      type: "background",
      paint: { "background-color": "#071217" },
    },
  ],
};

const HELM_ROUTE = {
  DARK: "#35d6ad",
  LIGHT: "#087f73",
} as const;

interface HelmMapProps {
  position: Position;
  headingDegrees: number;
  mission: Mission | null;
  waypointIndex: number;
  /** The objective this boat is working to, and how much water it claims. */
  objective: Position | null;
  objectiveRadiusNm: number;
  /** The corner chart burns the same daylight as the chart it mirrors. */
  theme: "DARK" | "LIGHT";
}

function routeData(
  position: Position,
  mission: Mission | null,
  waypointIndex: number,
) {
  const ahead = mission?.waypoints.slice(waypointIndex) ?? [];

  return {
    type: "FeatureCollection" as const,
    features: ahead.length === 0 ? [] : [
      {
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [position.longitude, position.latitude],
            ...ahead.map((point) => [point.longitude, point.latitude]),
          ],
        },
      },
    ],
  };
}

/**
 * The corner chart: where the boat is, course up, with the leg it is running.
 * It is a readout rather than a control — the fleet chart is where an operator
 * works — so it takes no pointer input and never steals a gesture from the
 * stage beside it.
 *
 * It carries the same water as the fleet chart, and that is the point. Taking a
 * boat used to mean losing the chart: this corner drew seamarks on a bare
 * basemap, so depth, relief and every ship in the harbour vanished at exactly
 * the moment the operator was closest to them. Same depth areas, same isobaths
 * and soundings, same relief, same live AIS hulls, same objective area, built
 * from the same modules the fleet chart builds from.
 */
export default function HelmMap({
  position,
  headingDegrees,
  mission,
  waypointIndex,
  objective,
  objectiveRadiusNm,
  theme,
}: HelmMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const themeRef = useRef(theme);
  const objectiveAreaRef = useRef<ObjectiveAreaOverlay | null>(null);
  const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (accessToken) mapboxgl.accessToken = accessToken;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: accessToken ? "mapbox://styles/mapbox/standard" : LOCAL_TACTICAL_STYLE,
      config: accessToken
        ? {
          basemap: {
            theme: "monochrome",
            lightPreset: themeRef.current === "LIGHT" ? "day" : "night",
          },
        }
        : undefined,
      center: [position.longitude, position.latitude],
      zoom: 14.6,
      pitch: 0,
      interactive: false,
      attributionControl: false,
      testMode: !accessToken,
    });

    const detachErrors = attachChartErrors(map, "helm chart");

    map.on("style.load", () => {
      // Ordered by slot rather than beforeId: Mapbox will not rearrange a
      // slotted layer against one in a different slot.
      // Same as the fleet chart: the DEM is Mapbox's, so it is only requested
      // when there is a token to request it with.
      if (accessToken) addTerrain(map);
      addSeascape(map);
      addSeamapLayers(map);
      addContactIcon(map);
      addAisLayers(map);

      // Hulls, not names. A contact's name is already on the stage beside this,
      // attached to the model it belongs to; repeating it here would cover the
      // water the chart exists to show.
      if (map.getLayer(AIS_LAYERS.label)) {
        map.setLayoutProperty(AIS_LAYERS.label, "visibility", "none");
      }

      map.addSource("helm-route", { type: "geojson", data: routeData(position, mission, waypointIndex) });
      map.addLayer({
        id: "helm-route-line",
        type: "line",
        source: "helm-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": HELM_ROUTE[themeRef.current],
          "line-width": 2.4,
          "line-opacity": 0.9,
        },
      });

      containerRef.current?.setAttribute("data-helm-map-ready", "true");
    });

    objectiveAreaRef.current = createObjectiveArea({ map, theme: themeRef.current });

    mapRef.current = map;

    return () => {
      detachErrors();
      objectiveAreaRef.current?.destroy();
      objectiveAreaRef.current = null;
      mapRef.current = null;
      map.remove();
    };
    // The map is built once; position, course and route are pushed in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  // Live traffic ages out. The fleet chart reloads the AIS source on the
  // service's own cadence and so does this one — a corner chart showing ships
  // from four minutes ago is worse than one showing none.
  useEffect(() => {
    const timer = setInterval(() => {
      const map = mapRef.current;
      if (!map) return;

      try {
        const source = map.getSource(AIS_SOURCE);
        if (source && "reload" in source) (source as { reload: () => void }).reload();
      } catch {
        // A removed map has no style to reload a source on.
      }
    }, AIS_REFRESH_MS);

    return () => clearInterval(timer);
  }, []);

  // The basemap carries the theme itself: a chart that stays night-lit beside a
  // daylit console reads as a different chart rather than the same one.
  useEffect(() => {
    themeRef.current = theme;
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (map.getLayer("helm-route-line")) {
        map.setPaintProperty("helm-route-line", "line-color", HELM_ROUTE[theme]);
      }

      setSeascapeTheme(map, theme);
      setOpenWatersTheme(map, theme);
      objectiveAreaRef.current?.setTheme(theme);

      if (!accessToken) return;

      // Not guarded on isStyleLoaded(): a map with a reloading source reports
      // its style as perpetually un-loaded, so the guard silently skips every
      // toggle. The call is cheap, and it reports its own refusals.
      setBasemapTheme(map, theme);
    };

    const safeApply = () => {
      try {
        apply();
      } catch {
        // A style mid-swap picks it up on the next style.load.
      }
    };

    safeApply();
    map.on("style.load", safeApply);
    return () => {
      map.off("style.load", safeApply);
    };
  }, [theme, accessToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Course up, so the corner chart agrees with the view beside it.
    map.jumpTo({
      center: [position.longitude, position.latitude],
      bearing: headingDegrees,
    });

    const source = map.getSource("helm-route") as mapboxgl.GeoJSONSource | undefined;
    source?.setData(routeData(position, mission, waypointIndex));
  }, [position, headingDegrees, mission, waypointIndex]);

  // The ground the boat was sent to work, drawn here in the same orange it
  // wears on the fleet chart. The leader runs to this hull, because from the
  // helm the only vessel whose relationship to the objective matters is this
  // one.
  useEffect(() => {
    objectiveAreaRef.current?.setArea(objective === null ? null : {
      center: objective,
      radiusNm: objectiveRadiusNm,
      tasked: mission === null ? [] : [position],
    });
  }, [objective, objectiveRadiusNm, mission, position]);

  return (
    <div className="helm-map">
      <div className="helm-map-canvas" ref={containerRef} />
      <span className="helm-map-own" aria-hidden="true" />
      {/* Course up, so north moves. The mark has to turn with it or it lies. */}
      <span
        className="helm-map-rose"
        style={{ transform: `rotate(${-headingDegrees}deg)` }}
        title={`North, ${headingDegrees.toFixed(0)}° off the bow`}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 L15 12 L12 10 L9 12 Z" />
        </svg>
        N
      </span>
    </div>
  );
}
