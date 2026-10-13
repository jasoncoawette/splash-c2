"use client";

import mapboxgl, { type Map as MapboxMap, type StyleSpecification } from "mapbox-gl";
import { useEffect, useRef } from "react";

import type { BoatType, Mission, Position } from "../../core/types";
import type { HelmCamera, OrbitState } from "../../store/commandSlice.ts";
import {
  addAisLayers,
  addContactIcon,
  addSeamapLayers,
  AIS_REFRESH_MS,
  AIS_SOURCE,
  setOpenWatersTheme,
} from "../chart/openWaters";
import {
  addSeascape,
  addTerrain,
  setBasemapTheme,
  setSeascapeTheme,
  setTerrainRelief,
} from "../chart/seascape";
import { attachChartErrors } from "../chart/chartErrors";
import { createObjectiveArea, type ObjectiveAreaOverlay } from "../chart/objectiveArea";
import { createVesselLayer, type VesselCustomLayer, type VesselMapBoat } from "../vessel";
import type { HelmNeighbour } from "./HelmView";

// THE HELM STAGE
//
// The water the boat is actually on, not a drawing of it.
//
// This view used to be a Three.js scene with an invented world in it: a sea
// plane carrying a scrolling grid, a shore mesh sampled from an 80x52 elevation
// grid baked into the bundle, a procedural seabed, and AIS traffic drawn as
// grey slabs floating above the plane. At roughly 370 m per cell the shore was
// a smear with no harbour in it, and the chart in the corner of the same screen
// was drawing the real thing at the same moment.
//
// So the corner chart won. This is the same map, pitched over onto the water:
// the Standard basemap for the land, the Mapbox DEM displaced in 3D so the
// shore stands up and occludes what is behind it, and the Open Waters layers
// the fleet chart carries — depth areas, isobaths, soundings, seamarks, and
// live AIS hulls where the slabs used to be. Only the boats are drawn by us,
// through the same custom layer the fleet chart uses, so a hull looks like
// itself in both views.

const LOCAL_TACTICAL_STYLE: StyleSpecification = {
  version: 8,
  name: "Splash C2 helm water",
  sources: {},
  layers: [
    { id: "water", type: "background", paint: { "background-color": "#071217" } },
  ],
};

const HELM_ROUTE = {
  DARK: "#35d6ad",
  LIGHT: "#087f73",
} as const;

const ROUTE_SOURCE = "helm-stage-route";
const ROUTE_LAYER = "helm-stage-route-line";

/**
 * Relief is drawn true. The chart's hillshade can afford to exaggerate because
 * it is read from above; from the waterline an exaggerated hill is a lie about
 * what is blocking the horizon.
 */
const TERRAIN_EXAGGERATION = 1;

/**
 * THE FOUR STATIONS
 *
 * Mapbox's camera orbits a point on the ground and tilts; it cannot be bolted
 * to the mast at its true height. So a station is a camera preset rather than a
 * mount, chosen so each answers the question its name implies.
 *
 * `pitch` is capped at 85 by Mapbox. `lift` drops the boat down the frame as a
 * fraction of stage height, which is what buys the sky and the shore standing
 * in it — centred, a pitched camera spends half the frame on the water
 * immediately alongside the hull.
 *
 * EXTERNAL carries no pitch or zoom here because it reads them off the orbit,
 * which is the one station `nudgeOrbit` lets the operator move.
 */
const STATIONS: Record<HelmCamera, {
  pitch: number;
  zoom: number;
  bearingOffset: number;
  lift: number;
}> = {
  // Over the bow, as low as the projection goes: most of the frame is what the
  // boat is driving into.
  BOW: { pitch: 85, zoom: 16.4, bearingOffset: 0, lift: 0.3 },
  // Up the mast and tipped back down: close water and the shore beyond it.
  MAST: { pitch: 72, zoom: 15.8, bearingOffset: 0, lift: 0.2 },
  // The same low eye, looking back down the wake.
  AFT: { pitch: 85, zoom: 16.4, bearingOffset: 180, lift: 0.3 },
  // Overridden by the orbit; these are only what it opens on.
  EXTERNAL: { pitch: 74, zoom: 17.2, bearingOffset: 0, lift: 0.08 },
};

/**
 * The orbit speaks in degrees above the waterline and metres off the hull,
 * because that is what it meant to a camera that could be placed. Mapbox tilts
 * from straight down instead, so elevation becomes 90 minus itself, and range
 * becomes zoom on a log scale — halving the distance is one zoom level, which
 * is what makes the wheel feel even all the way in.
 */
const ORBIT_RANGE_M = { min: 12, max: 900 } as const;
const ORBIT_ZOOM_SPAN = 3;

function externalCamera(orbit: OrbitState): { pitch: number; zoom: number } {
  const reach = Math.min(
    Math.max(
      Math.log(Math.max(orbit.distanceM, ORBIT_RANGE_M.min) / ORBIT_RANGE_M.min)
        / Math.log(ORBIT_RANGE_M.max / ORBIT_RANGE_M.min),
      0,
    ),
    1,
  );

  return {
    pitch: Math.min(Math.max(90 - orbit.pitchDegrees, 0), 85),
    zoom: STATIONS.EXTERNAL.zoom - reach * ORBIT_ZOOM_SPAN,
  };
}

export type HelmTheme = "DARK" | "LIGHT";

interface HelmStageProps {
  boatId: string;
  name: string;
  type: BoatType;
  position: Position;
  headingDegrees: number;
  speedKnots: number;
  /** Other friendly hulls, drawn from the models the chart draws. */
  neighbours: readonly HelmNeighbour[];
  mission: Mission | null;
  waypointIndex: number;
  objective: Position | null;
  objectiveRadiusNm: number;
  theme: HelmTheme;
  camera: HelmCamera;
  orbit: OrbitState;
  onOrbit: (delta: { yaw?: number; pitch?: number; distance?: number }) => void;
}

function routeData(position: Position, mission: Mission | null, waypointIndex: number) {
  const ahead = mission?.waypoints.slice(waypointIndex) ?? [];

  return {
    type: "FeatureCollection" as const,
    features: ahead.length === 0 ? [] : [{
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [position.longitude, position.latitude],
          ...ahead.map((point) => [point.longitude, point.latitude]),
        ],
      },
    }],
  };
}

/**
 * Own hull first, then the neighbours. The boat being driven is the selection,
 * so it wears the objective orange the chart gives a selected hull and the rest
 * stay plain.
 */
function stageBoats(
  own: { id: string; name: string; type: BoatType; position: Position; headingDegrees: number; speedKnots: number },
  neighbours: readonly HelmNeighbour[],
): VesselMapBoat[] {
  return [
    {
      id: own.id,
      name: own.name,
      type: own.type,
      longitude: own.position.longitude,
      latitude: own.position.latitude,
      headingDegrees: own.headingDegrees,
      speedKnots: own.speedKnots,
      selected: true,
      labelSlot: 0 as const,
    },
    ...neighbours.map((boat, index) => ({
      id: boat.id,
      name: boat.name,
      type: boat.type,
      longitude: boat.position.longitude,
      latitude: boat.position.latitude,
      headingDegrees: boat.headingDegrees,
      speedKnots: boat.speedKnots,
      selected: false,
      labelSlot: ([-1, 1, 0] as const)[index % 3],
    })),
  ];
}

export default function HelmStage({
  boatId,
  name,
  type,
  position,
  headingDegrees,
  speedKnots,
  neighbours,
  mission,
  waypointIndex,
  objective,
  objectiveRadiusNm,
  theme,
  camera: station,
  orbit,
  onOrbit,
}: HelmStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const layerRef = useRef<VesselCustomLayer | null>(null);
  const objectiveAreaRef = useRef<ObjectiveAreaOverlay | null>(null);
  const themeRef = useRef(theme);
  const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

  // The gesture handlers are bound once and read the latest callback through
  // this, rather than being torn down and rebuilt on every tick of the
  // simulation.
  const onOrbitRef = useRef(onOrbit);
  useEffect(() => {
    onOrbitRef.current = onOrbit;
  });

  const initialBoatsRef = useRef(
    stageBoats({ id: boatId, name, type, position, headingDegrees, speedKnots }, neighbours),
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (accessToken) mapboxgl.accessToken = accessToken;

    const preset = STATIONS.BOW;
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
      zoom: preset.zoom,
      pitch: preset.pitch,
      bearing: headingDegrees,
      // The operator drives with the keyboard and swings the view by dragging;
      // Mapbox's own pan and zoom would fight the boat for the camera.
      interactive: false,
      attributionControl: false,
      testMode: !accessToken,
    });

    const detachErrors = attachChartErrors(map, "helm stage");

    map.on("style.load", () => {
      if (accessToken) {
        addTerrain(map);
        // The one call that makes this a view rather than a tilted chart.
        setTerrainRelief(map, TERRAIN_EXAGGERATION);
        containerRef.current?.setAttribute(
          "data-relief",
          map.getTerrain() ? "on" : "off",
        );
      }

      addSeascape(map);
      addSeamapLayers(map);
      addContactIcon(map);
      addAisLayers(map);

      map.addSource(ROUTE_SOURCE, {
        type: "geojson",
        data: routeData(position, mission, waypointIndex),
      });
      map.addLayer({
        id: ROUTE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        slot: "top",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": HELM_ROUTE[themeRef.current],
          "line-width": 3,
          "line-opacity": 0.9,
          "line-emissive-strength": themeRef.current === "DARK" ? 1 : 0,
        },
      });

      const layer = createVesselLayer(initialBoatsRef.current);
      layerRef.current = layer;
      map.addLayer(layer);

      containerRef.current?.setAttribute("data-helm-stage-ready", "true");
    });

    objectiveAreaRef.current = createObjectiveArea({ map, theme: themeRef.current });
    mapRef.current = map;

    return () => {
      detachErrors();
      objectiveAreaRef.current?.destroy();
      objectiveAreaRef.current = null;
      layerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
    // Built once. Everything live is pushed in by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  // AIS ages out. Reload on the service's own cadence, exactly as the fleet
  // chart and the corner chart do — a hull reported four minutes ago is worse
  // than no hull at all when the operator is driving past it.
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

  // Drag swings the view around the boat and the wheel moves it in and out.
  // Both go through the store, so the station the operator left the helm on is
  // the one they come back to.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      container?.setPointerCapture(event.pointerId);
      container?.setAttribute("data-dragging", "true");
    }

    function onPointerMove(event: PointerEvent) {
      if (!dragging) return;
      const deltaX = event.clientX - lastX;
      const deltaY = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      onOrbitRef.current({ yaw: -deltaX * 0.3, pitch: -deltaY * 0.2 });
    }

    function endDrag(event: PointerEvent) {
      if (!dragging) return;
      dragging = false;
      container?.releasePointerCapture(event.pointerId);
      container?.removeAttribute("data-dragging");
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      onOrbitRef.current({ distance: event.deltaY * 0.6 });
    }

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", endDrag);
    container.addEventListener("pointercancel", endDrag);
    container.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", endDrag);
      container.removeEventListener("pointercancel", endDrag);
      container.removeEventListener("wheel", onWheel);
    };
  }, []);

  // Theme: the basemap carries it, so the stage and the chart beside it are lit
  // by the same sun rather than reading as two different days.
  useEffect(() => {
    themeRef.current = theme;
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (map.getLayer(ROUTE_LAYER)) {
        map.setPaintProperty(ROUTE_LAYER, "line-color", HELM_ROUTE[theme]);
        // Standard lights the layers in its slots, and the night preset crushes
        // an unlit line to near black.
        map.setPaintProperty(ROUTE_LAYER, "line-emissive-strength", theme === "DARK" ? 1 : 0);
      }

      setSeascapeTheme(map, theme);
      setOpenWatersTheme(map, theme);
      objectiveAreaRef.current?.setTheme(theme);

      if (!accessToken) return;
      setBasemapTheme(map, theme);
    };

    // Not guarded on isStyleLoaded(): a reloading AIS source keeps the style
    // perpetually un-settled, so the guard would silently skip every toggle.
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

  // The camera. Course up, boat low in the frame.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const preset = STATIONS[station];
    // Dragging the stage moves to the chase view, so only that station reads
    // the orbit. The fixed three are exactly what their preset says.
    const external = station === "EXTERNAL";
    const swung = external ? externalCamera(orbit) : null;
    const { height } = map.getCanvas().getBoundingClientRect();

    map.jumpTo({
      center: [position.longitude, position.latitude],
      bearing: headingDegrees + preset.bearingOffset + (external ? orbit.yawDegrees : 0),
      pitch: swung?.pitch ?? preset.pitch,
      zoom: swung?.zoom ?? preset.zoom,
      // Top padding shrinks the viewport the centre is placed in, which drops
      // the boat down the frame and lifts the horizon — and the shore standing
      // on it — into view. Padding moves the centre by half what it reserves,
      // hence the doubling.
      padding: { top: height * preset.lift * 2, bottom: 0, left: 0, right: 0 },
    });
  }, [position, headingDegrees, station, orbit]);

  // Boats, route and objective: the three things that change on every tick.
  useEffect(() => {
    layerRef.current?.setBoats(
      stageBoats({ id: boatId, name, type, position, headingDegrees, speedKnots }, neighbours),
    );
  }, [boatId, name, type, position, headingDegrees, speedKnots, neighbours]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const source = map.getSource(ROUTE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    source?.setData(routeData(position, mission, waypointIndex));
  }, [position, mission, waypointIndex]);

  useEffect(() => {
    objectiveAreaRef.current?.setArea(objective === null ? null : {
      center: objective,
      radiusNm: objectiveRadiusNm,
      tasked: mission === null ? [] : [position],
    });
  }, [objective, objectiveRadiusNm, mission, position]);

  return <div className="helm-stage-map" ref={containerRef} />;
}
