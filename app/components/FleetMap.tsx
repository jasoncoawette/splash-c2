"use client";

import mapboxgl, {
  type GeoJSONSource,
  type LngLatBoundsLike,
  type Map as MapboxMap,
  type StyleSpecification,
} from "mapbox-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Position } from "../core/types";
import { useAppDispatch, useAppSelector } from "../store/hooks.ts";
import {
  boatSelected,
  boatsSelected,
  chartTerrainToggled,
  objectiveCleared,
  objectiveMoved,
} from "../store/commandSlice.ts";
import {
  selectBoatViews,
  selectChartTerrain,
  selectChartTool,
  selectObjective,
  selectGroups,
  selectRadiusNm,
  selectRoutes,
  selectSelectedBoatId,
  selectSelectedIds,
} from "../store/selectors.ts";
import {
  removeBoat as orderRemoveBoat,
  raisePerimeter as orderRaisePerimeter,
  reshapePerimeter as orderReshapePerimeter,
} from "../store/orders.ts";
import { boatTargeted, contactTargeted, contactsReported } from "../store/trafficSlice.ts";
import { colourByBoat } from "./chart/groupColours";
import {
  followSelection as orderFollowSelection,
  routeSelection as orderRouteSelection,
  takeOver as orderTakeOver,
} from "../store/orders.ts";
import { boatRecalled } from "../store/fleetSlice.ts";
import ChartActions, {
  type ChartAction,
  type ChartFocus,
} from "./chart/ChartActions";
import { perimeterSelected, type Perimeter } from "../store/perimeterSlice.ts";
import { themeToggled } from "../store/appearanceSlice.ts";
import { cellToggled } from "../store/surveySlice.ts";
import { createGroupDrag, type GroupDrag } from "./map";
import {
  addAisLayers,
  addContactIcon,
  addSeamapLayers,
  AIS_REFRESH_MS,
  AIS_LAYERS,
  AIS_SOURCE,
  readAisContacts,
  setOpenWatersTheme,
  type AisContact,
} from "./chart/openWaters";
import { attachChartErrors } from "./chart/chartErrors";
import {
  addSeascape,
  addTerrain,
  SEASCAPE_LAYERS,
  setBasemapTheme,
  setSeascapeTheme,
} from "./chart/seascape";
import {
  addSurveyLayers,
  surveyData,
  surveyGridData,
  SURVEY_GRID_LINE,
  SURVEY_GRID_SOURCE,
  SURVEY_SOURCE,
} from "./chart/surveyLayer";
import {
  addObjectiveAreaLayers,
  createObjectiveArea,
  emissive,
  OBJECTIVE_ORANGE,
  type ObjectiveArea,
  type ObjectiveAreaOverlay,
} from "./chart/objectiveArea";
import {
  addPerimeterLayers,
  createPerimeterHandles,
  perimeterBounds,
  type PerimeterHandles,
  type PerimeterShape,
} from "./chart/perimeterLayer";
import {
  createVesselLayer,
  type VesselCustomLayer,
  type VesselMapBoat,
} from "./vessel";

export interface MapRoute {
  id: string;
  boatId: string;
  coordinates: readonly (readonly [number, number])[];
  active: boolean;
}



const LOCAL_TACTICAL_STYLE: StyleSpecification = {
  version: 8,
  name: "Splash C2 tactical water",
  sources: {},
  layers: [
    {
      id: "water",
      type: "background",
      paint: {
        "background-color": "#071217",
      },
    },
  ],
};

/**
 * Traffic layers, in the order a click should resolve them. The hit target
 * comes first: it is the widest and it carries the same properties as the hull.
 */
const TRAFFIC_LAYERS = [
  AIS_LAYERS.hit,
  AIS_LAYERS.target,
  AIS_LAYERS.label,
  AIS_LAYERS.hull,
  AIS_LAYERS.underway,
] as const;

/** How far off a contact a press may land and still count, in pixels. */
const TRAFFIC_SLOP = 9;

/**
 * What traffic, if any, is under a point. The query is a box rather than a
 * pixel: a contact is a small arrowhead on water that is usually moving, and
 * asking for a pixel-perfect click on one is what made traffic feel unpickable
 * without the panel list.
 */
function queryTraffic(
  map: MapboxMap,
  point: mapboxgl.Point,
): mapboxgl.MapboxGeoJSONFeature[] {
  const layers = TRAFFIC_LAYERS.filter((layerId) => map.getLayer(layerId));
  if (layers.length === 0) return [];

  const box: [mapboxgl.PointLike, mapboxgl.PointLike] = [
    [point.x - TRAFFIC_SLOP, point.y - TRAFFIC_SLOP],
    [point.x + TRAFFIC_SLOP, point.y + TRAFFIC_SLOP],
  ];

  return map.queryRenderedFeatures(box, { layers });
}

/**
 * A route leg exists because an objective was dropped, so it is drawn in the
 * objective's orange rather than a colour of its own. The route used to switch
 * hue between tasked and untasked, which read as two different kinds of line;
 * the difference is weight and opacity now, which is what it always meant.
 */
function routeColour(theme: "DARK" | "LIGHT"): string {
  return OBJECTIVE_ORANGE[theme];
}

function routeData(
  routes: readonly MapRoute[],
  colours: Map<string, string>,
) {
  return {
    type: "FeatureCollection" as const,
    features: routes.flatMap((route) => [
      {
        type: "Feature" as const,
        properties: {
          active: route.active ? 1 : 0,
          colour: colours.get(route.boatId),
        },
        geometry: {
          type: "LineString" as const,
          coordinates: route.coordinates.map((pair) => [pair[0], pair[1]]),
        },
      },
      ...route.coordinates.map((pair) => ({
        type: "Feature" as const,
        properties: {
          active: route.active ? 1 : 0,
          colour: colours.get(route.boatId),
        },
        geometry: {
          type: "Point" as const,
          coordinates: [pair[0], pair[1]],
        },
      })),
    ]),
  };
}

function fleetBounds(boats: readonly VesselMapBoat[]): LngLatBoundsLike | null {
  if (boats.length === 0) return null;

  const bounds = new mapboxgl.LngLatBounds(
    [boats[0].longitude, boats[0].latitude],
    [boats[0].longitude, boats[0].latitude],
  );

  for (const boat of boats) bounds.extend([boat.longitude, boat.latitude]);

  return bounds;
}

/** A stable empty reference, so a missing slice cannot loop the selector. */
const EMPTY_PERIMETERS: Perimeter[] = [];

export default function FleetMap() {
  const dispatch = useAppDispatch();

  const boats = useAppSelector(selectBoatViews);
  const routes = useAppSelector(selectRoutes);
  const selectedBoatId = useAppSelector(selectSelectedBoatId);
  const groupIds = useAppSelector(selectSelectedIds);
  const groups = useAppSelector(selectGroups);
  // Which hue each hull carries, so a group reads on the chart without a label.
  const groupColours = useMemo(() => colourByBoat(groups), [groups]);
  const objective = useAppSelector(selectObjective);
  // How much water the objective claims. Planned against since the start, but
  // until now never drawn — the route ring was the only evidence of it.
  const radiusNm = useAppSelector(selectRadiusNm);
  const tool = useAppSelector(selectChartTool);
  const seascape = useAppSelector(selectChartTerrain);
  const theme = useAppSelector((state) => state.appearance?.theme ?? "DARK");
  const targetMmsi = useAppSelector((state) => state.traffic.targetMmsi);
  const perimeterList = useAppSelector((state) => state.perimeters?.perimeters ?? EMPTY_PERIMETERS);
  const activePerimeterId = useAppSelector((state) => state.perimeters?.activeId ?? null);
  const panelOpen = useAppSelector((state) => state.command.fleetPanelOpen ?? true);

  const perimeters = useMemo<PerimeterShape[]>(
    () => perimeterList.map((perimeter) => ({
      id: perimeter.id,
      name: perimeter.name,
      center: perimeter.center,
      radiusNm: perimeter.radiusNm,
      active: perimeter.id === activePerimeterId,
      boatCount: perimeter.boatIds.length,
    })),
    [perimeterList, activePerimeterId],
  );

  // The chart frames the whole fleet while the panel is open, and follows the
  // tasked vessel once it is out of the way.
  const overview = panelOpen;
  const showObjective = true;

  // What the operator last clicked on the chart, and where it is on screen.
  // Kept in step with the camera so the overlay stays glued to its object.
  const [focus, setFocus] = useState<ChartFocus | null>(null);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);

  const onSelectBoat = useCallback((boatId: string) => {
    dispatch(boatSelected(boatId));
  }, [dispatch]);
  const onRemoveBoat = useCallback((boatId: string) => {
    dispatch(orderRemoveBoat(boatId));
  }, [dispatch]);
  const onSelectBoats = useCallback((boatIds: readonly string[]) => {
    dispatch(boatsSelected(boatIds));
  }, [dispatch]);
  const onObjectiveChange = useCallback((next: Position) => {
    dispatch(objectiveMoved(next));
  }, [dispatch]);
  const onContactsChange = useCallback((next: readonly AisContact[]) => {
    dispatch(contactsReported(next));
  }, [dispatch]);
  const onContactTargeted = useCallback((mmsi: number | null) => {
    dispatch(contactTargeted(mmsi));
  }, [dispatch]);
  const onPerimeterReshape = useCallback((
    id: string,
    shape: { center?: Position; radiusNm?: number },
  ) => {
    dispatch(orderReshapePerimeter(id, shape));
  }, [dispatch]);
  const onPerimeterSelect = useCallback((id: string) => {
    dispatch(perimeterSelected(id));

    // Picking up a ring picks up the boats flying it, so it can be re-tasked
    // without hunting for its members in the registry.
    const ring = perimeterList.find((item) => item.id === id);
    if (ring && ring.boatIds.length > 0) dispatch(boatsSelected(ring.boatIds));
  }, [dispatch, perimeterList]);
  const onPerimeterRequest = useCallback((center: Position) => {
    dispatch(objectiveMoved(center));
    dispatch(orderRaisePerimeter());
  }, [dispatch]);
  const onToggleTheme = useCallback(() => {
    dispatch(themeToggled());
  }, [dispatch]);
  const onDeleteObjective = useCallback(() => {
    dispatch(objectiveCleared());
  }, [dispatch]);

  const onToggleSeascape = useCallback(() => {
    dispatch(chartTerrainToggled());
  }, [dispatch]);

  const dismissFocus = useCallback(() => {
    setFocus(null);
    setFocusPoint(null);
  }, []);

  // What you can do with the thing you clicked. Built here because the answer
  // depends on fleet and traffic state, not on the shape of the overlay.
  const focusActions = useMemo<ChartAction[]>(() => {
    if (!focus) return [];

    if (focus.kind === "BOAT") {
      const boat = boats.find(({ state }) => state.id === focus.id);

      return [
        {
          id: "take-over",
          label: "Take over",
          hint: "Front view",
          tone: "primary",
          run: () => dispatch(orderTakeOver(focus.id)),
        },
        {
          id: "screen-it",
          label: "Escort this vessel",
          hint: "With the selection",
          disabled: groupIds.length === 0 || (groupIds.length === 1 && groupIds[0] === focus.id),
          run: () => {
            dispatch(boatTargeted(focus.id));
            dispatch(orderFollowSelection("ESCORT"));
          },
        },
        {
          id: "recall",
          label: "Recall",
          hint: "Drop its tasking",
          disabled: !boat || boat.state.missionId === null,
          run: () => dispatch(boatRecalled(focus.id)),
        },
        {
          id: "remove",
          label: "Remove vessel",
          hint: "Right-click",
          tone: "danger",
          run: () => dispatch(orderRemoveBoat(focus.id)),
        },
      ];
    }

    if (focus.kind === "CONTACT") {
      const mmsi = Number(focus.id);

      return [
        {
          id: "escort",
          label: "Escort",
          hint: "Screen it and run with it",
          tone: "primary",
          disabled: groupIds.length === 0,
          run: () => {
            dispatch(contactTargeted(mmsi));
            dispatch(orderFollowSelection("ESCORT"));
          },
        },
        {
          id: "monitor",
          label: "Monitor",
          hint: "Shadow from a standoff ring",
          disabled: groupIds.length === 0,
          run: () => {
            dispatch(contactTargeted(mmsi));
            dispatch(orderFollowSelection("MONITOR"));
          },
        },
        {
          id: "target",
          label: "Target only",
          hint: "Without ordering",
          run: () => dispatch(contactTargeted(mmsi)),
        },
      ];
    }

    return [
      {
        id: "perimeter",
        label: "Raise perimeter here",
        tone: "primary",
        disabled: groupIds.length === 0,
        run: () => dispatch(orderRaisePerimeter()),
      },
      {
        id: "transit",
        label: "Transit here",
        hint: "Direct run",
        disabled: groupIds.length === 0,
        run: () => dispatch(orderRouteSelection("TRANSIT")),
      },
      {
        id: "sweep",
        label: "Sweep here",
        hint: "Parallel search lanes",
        disabled: groupIds.length === 0,
        run: () => dispatch(orderRouteSelection("SWEEP")),
      },
      {
        id: "station",
        label: "Hold station here",
        disabled: groupIds.length === 0,
        run: () => dispatch(orderRouteSelection("STATION")),
      },
      {
        id: "delete-objective",
        label: "Delete objective",
        hint: "Right-click",
        tone: "danger",
        run: () => dispatch(objectiveCleared()),
      },
    ];
  }, [focus, boats, groupIds, dispatch]);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const layerRef = useRef<VesselCustomLayer | null>(null);
  const markersRef = useRef(new Map<string, mapboxgl.Marker>());
  const objectiveMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const surveyCells = useAppSelector((state) => state.survey.cells);
  const surveySizeNm = useAppSelector((state) => state.survey.cellSizeNm);
  const surveyRef = useRef({ cells: surveyCells, sizeNm: surveySizeNm });
  const toolRef = useRef(tool);
  const perimeterRequestRef = useRef(onPerimeterRequest);
  const themeRef = useRef(theme);
  const colourRef = useRef(groupColours);
  const focusRef = useRef<((next: ChartFocus | null) => void) | null>(null);
  const deleteObjectiveRef = useRef(onDeleteObjective);
  const objectiveRef2 = useRef(objective);
  const seenPerimetersRef = useRef(new Set<string>());
  const selectRef = useRef(onSelectBoat);
  const objectiveRef = useRef(onObjectiveChange);
  const contactsRef = useRef(onContactsChange);
  const targetRef = useRef(onContactTargeted);
  const reshapeRef = useRef(onPerimeterReshape);
  const perimeterSelectRef = useRef(onPerimeterSelect);
  const perimeterHandlesRef = useRef<PerimeterHandles | null>(null);
  const objectiveAreaRef = useRef<ObjectiveAreaOverlay | null>(null);
  const objectiveAreaStateRef = useRef<ObjectiveArea | null>(null);
  const removeRef = useRef(onRemoveBoat);
  const selectGroupRef = useRef(onSelectBoats);
  const groupDragRef = useRef<GroupDrag | null>(null);
  const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

  useEffect(() => {
    themeRef.current = theme;
    colourRef.current = groupColours;
    toolRef.current = tool;
    surveyRef.current = { cells: surveyCells, sizeNm: surveySizeNm };
    objectiveRef2.current = objective;
    focusRef.current = setFocus;
    deleteObjectiveRef.current = onDeleteObjective;
    perimeterRequestRef.current = onPerimeterRequest;
    selectRef.current = onSelectBoat;
    objectiveRef.current = onObjectiveChange;
    contactsRef.current = onContactsChange;
    targetRef.current = onContactTargeted;
    reshapeRef.current = onPerimeterReshape;
    perimeterSelectRef.current = onPerimeterSelect;
    removeRef.current = onRemoveBoat;
    selectGroupRef.current = onSelectBoats;
  }, [theme, groupColours, perimeterList, tool, objective, surveyCells, surveySizeNm, onDeleteObjective, onPerimeterRequest, onSelectBoat, onRemoveBoat, onSelectBoats, onObjectiveChange, onContactsChange, onContactTargeted, onPerimeterReshape, onPerimeterSelect]);

  // The group is what a drag moves. With no group the selected boat is dragged
  // on its own, so a single hull still answers to the pointer.
  const dragIds = useMemo<readonly string[]>(
    () => (groupIds.length > 0 ? groupIds : selectedBoatId ? [selectedBoatId] : []),
    [groupIds, selectedBoatId],
  );

  const group = useMemo(() => new Set(groupIds), [groupIds]);
  const links = useAppSelector((state) => state.scenario.links);
  const mapBoats = useMemo<VesselMapBoat[]>(
    () => boats.map(({ definition, state }, boatIndex) => ({
      id: state.id,
      name: definition.name,
      type: definition.type,
      longitude: state.position.longitude,
      latitude: state.position.latitude,
      headingDegrees: state.headingDegrees,
      speedKnots: state.speedKnots,
      selected: state.id === selectedBoatId,
      grouped: groupIds.includes(state.id),
      linkLost: links[state.id] === "LOST",
      // Selection is drawn in the objective's orange: the brackets, the pin and
      // the route legs are one colour, so "this is the boat I am working with"
      // and "this is where I am sending it" read as the same thought. Cyan
      // still means "our fleet"; it cannot also mean "this one".
      tint: links[state.id] === "LOST"
        ? "#ff6e6e"
        : groupColours.get(state.id) ?? OBJECTIVE_ORANGE[theme],
      labelSlot: ([-1, 1, 0] as const)[boatIndex % 3],
    })),
    [boats, selectedBoatId, groupIds, groupColours, links, theme],
  );
  const initialMapBoatsRef = useRef(mapBoats);
  const mapBoatsRef = useRef(mapBoats);
  const routesRef = useRef(routes);
  const flownToRef = useRef<string | null>(null);
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const markers = markersRef.current;

    if (accessToken) mapboxgl.accessToken = accessToken;

    const focus = initialMapBoatsRef.current.find((boat) => boat.selected)
      ?? initialMapBoatsRef.current[0];

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: accessToken ? "mapbox://styles/mapbox/standard" : LOCAL_TACTICAL_STYLE,
      config: accessToken
        ? { basemap: { theme: "monochrome", lightPreset: themeRef.current === "LIGHT" ? "day" : "night" } }
        : undefined,
      center: focus ? [focus.longitude, focus.latitude] : [-118.25, 33.74],
      zoom: focus ? 14.6 : 13.4,
      pitch: 56,
      bearing: -18,
      antialias: true,
      projection: "mercator",
      testMode: !accessToken,
      attributionControl: false,
      logoPosition: "bottom-left",
    });
    // Before anything can fail: with no listener, Mapbox prints its own errors
    // to the console from inside the GL worker.
    const detachErrors = attachChartErrors(map, "chart");

    map.on("style.load", () => {
      // Relief comes from Mapbox's own DEM, so it is only asked for when there
      // is a token to ask with. Without one the tactical fallback style is on
      // screen and every mapbox:// request would be refused, once per tile.
      if (accessToken) addTerrain(map);
      addSeascape(map);

      map.addSource("mission-routes", {
        type: "geojson",
        data: routeData(routesRef.current, colourRef.current),
      });
      map.addLayer({
        id: "mission-route-lines",
        type: "line",
        source: "mission-routes",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": routeColour(themeRef.current),
          "line-width": ["case", ["==", ["get", "active"], 1], 2.4, 1.2],
          "line-opacity": ["case", ["==", ["get", "active"], 1], 0.85, 0.3],
          "line-dasharray": [2, 1.6],
          "line-emissive-strength": emissive(themeRef.current),
        },
      });
      map.addLayer({
        id: "mission-route-points",
        type: "circle",
        source: "mission-routes",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 3.4,
          "circle-color": "#071217",
          "circle-stroke-color": routeColour(themeRef.current),
          "circle-stroke-width": 1.4,
          "circle-opacity": 0.9,
          "circle-emissive-strength": emissive(themeRef.current),
        },
      });

      // Chart context is ordered by slot, so our hulls, routes and markers are
      // never buried by seamarks.
      addSeamapLayers(map);
      addPerimeterLayers(map);
      addObjectiveAreaLayers(map);
      addSurveyLayers(map);
      addContactIcon(map);
      addAisLayers(map);

      const layer = createVesselLayer(initialMapBoatsRef.current);
      layerRef.current = layer;
      map.addLayer(layer);
      containerRef.current?.setAttribute("data-layer-ready", "true");
    });

    // The objective is dropped, not derived from the camera: it stays on the
    // water where the operator put it however the chart is panned or zoomed.
    // The group-drag controller swallows the trailing click of a marquee or a
    // hull drag, so only a deliberate click reaches this.
    // One handler routes every chart click by the armed tool, so no two
    // actions can fire from the same press. The group-drag controller swallows
    // the trailing click of a marquee or hull drag, so only a deliberate click
    // arrives here.
    const onChartClick = (event: mapboxgl.MapMouseEvent) => {
      const point = { latitude: event.lngLat.lat, longitude: event.lngLat.lng };

      // A click on traffic always means "target this", whatever the tool: it is
      // the only way to pick a contact, and no tool wants to place something
      // on top of a ship.
      const hit = queryTraffic(map, event.point);

      if (hit.length > 0) {
        const properties = hit[0].properties ?? {};
        const mmsi = Number(properties.mmsi);

        if (Number.isFinite(mmsi)) {
          targetRef.current?.(mmsi);
          focusRef.current?.({
            kind: "CONTACT",
            id: String(mmsi),
            title: typeof properties.name === "string" && properties.name.trim()
              ? properties.name
              : `MMSI ${mmsi}`,
            subtitle: `${Number(properties.sog ?? 0).toFixed(1)} kn · ${properties.kind ?? "vessel"}`,
            longitude: event.lngLat.lng,
            latitude: event.lngLat.lat,
          });
          return;
        }
      }

      // Under a placement tool the click places; otherwise it asks "what can I
      // do with this?" of whatever sits under the pointer.
      if (toolRef.current === "OBJECTIVE") {
        objectiveRef.current?.(point);
        return;
      }

      if (toolRef.current === "PERIMETER") {
        perimeterRequestRef.current?.(point);
        return;
      }

      if (toolRef.current === "SURVEY") {
        dispatch(cellToggled(point));
        return;
      }

      const near = (lngLat: [number, number]) => {
        const projected = map.project(lngLat);
        return Math.hypot(projected.x - event.point.x, projected.y - event.point.y) <= 26;
      };

      const boat = mapBoatsRef.current.find((item) => near([item.longitude, item.latitude]));

      if (boat) {
        selectRef.current?.(boat.id);
        focusRef.current?.({
          kind: "BOAT",
          id: boat.id,
          title: boat.name,
          subtitle: `${boat.type} · ${boat.id}`,
          longitude: boat.longitude,
          latitude: boat.latitude,
        });
        return;
      }

      const pin = objectiveRef2.current;

      if (pin && near([pin.longitude, pin.latitude])) {
        focusRef.current?.({
          kind: "OBJECTIVE",
          id: "objective",
          title: "Objective",
          subtitle: `${Math.abs(pin.latitude).toFixed(4)}° ${pin.latitude >= 0 ? "N" : "S"} ${Math.abs(pin.longitude).toFixed(4)}° ${pin.longitude >= 0 ? "E" : "W"}`,
          longitude: pin.longitude,
          latitude: pin.latitude,
        });
        return;
      }

      // Open water. Clearing used to be a side effect of the marquee — a
      // zero-sized box selecting nothing — which is why it also swallowed the
      // click. It is a decision this handler makes now, and a held modifier
      // means the operator is still building a selection, so it stands.
      focusRef.current?.(null);

      const additive = event.originalEvent.shiftKey
        || event.originalEvent.metaKey
        || event.originalEvent.ctrlKey;

      if (!additive) selectGroupRef.current?.([]);
    };

    map.on("click", onChartClick);

    // Traffic is clickable whatever the armed tool, so the pointer has to say
    // so before the press: without the panel list, this hover is the only thing
    // that tells an operator a contact is a target and not scenery.
    const onChartHover = (event: mapboxgl.MapMouseEvent) => {
      const over = queryTraffic(map, event.point).length > 0;
      const host = containerRef.current;
      if (!host) return;

      if (over) host.dataset.chartHover = "contact";
      else delete host.dataset.chartHover;
    };

    const onChartLeave = () => {
      if (containerRef.current) delete containerRef.current.dataset.chartHover;
    };

    map.on("mousemove", onChartHover);
    map.on("mouseout", onChartLeave);

    const onChartContextMenu = (event: mapboxgl.MapMouseEvent) => {
      const near = (lngLat: [number, number]) => {
        const projected = map.project(lngLat);
        return Math.hypot(projected.x - event.point.x, projected.y - event.point.y) <= 26;
      };

      const boat = mapBoatsRef.current.find((item) => near([item.longitude, item.latitude]));

      if (boat) {
        event.preventDefault();
        removeRef.current?.(boat.id);
        focusRef.current?.(null);
        return;
      }

      const pin = objectiveRef2.current;

      if (pin && near([pin.longitude, pin.latitude])) {
        event.preventDefault();
        deleteObjectiveRef.current?.();
        focusRef.current?.(null);
      }
    };

    map.on("contextmenu", onChartContextMenu);

    // Figma's gesture: a press of the scroll wheel pans, whatever tool is
    // armed. Mapbox only pans on the left button, so the middle button is
    // translated into a pan here and handed back on release.
    const canvas = map.getCanvas();
    let wheelPan: { x: number; y: number } | null = null;

    const onMiddleDown = (event: PointerEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      wheelPan = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      document.body.dataset.chartDrag = "drag";
    };

    const onMiddleMove = (event: PointerEvent) => {
      if (!wheelPan) return;
      map.panBy([wheelPan.x - event.clientX, wheelPan.y - event.clientY], { duration: 0 });
      wheelPan = { x: event.clientX, y: event.clientY };
    };

    const onMiddleUp = (event: PointerEvent) => {
      if (!wheelPan) return;
      wheelPan = null;
      delete document.body.dataset.chartDrag;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };

    // Chrome turns a middle press into autoscroll without this.
    const blockAutoScroll = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };

    canvas.addEventListener("pointerdown", onMiddleDown);
    canvas.addEventListener("pointermove", onMiddleMove);
    canvas.addEventListener("pointerup", onMiddleUp);
    canvas.addEventListener("pointercancel", onMiddleUp);
    canvas.addEventListener("auxclick", blockAutoScroll);
    canvas.addEventListener("mousedown", blockAutoScroll);

    mapRef.current = map;
    flownToRef.current = focus?.id ?? null;

    const container = containerRef.current;
    const groupDrag = createGroupDrag({
      map,
      container,
      onSelectionChange: (ids) => selectGroupRef.current?.(ids),
    });
    groupDragRef.current = groupDrag;
    perimeterHandlesRef.current = createPerimeterHandles({
      map,
      onReshape: (id, shape) => reshapeRef.current?.(id, shape),
      onSelect: (id) => perimeterSelectRef.current?.(id),
      // Hand the trailing click to the one controller that already swallows
      // them, rather than racing a second capture-phase listener.
      onGestureEnd: () => groupDragRef.current?.swallowNextClick(),
    });
    objectiveAreaRef.current = createObjectiveArea({ map, theme: themeRef.current });
    // Seeded from the ref rather than waiting on the next objective change, so
    // a remount redraws the area that was already on the chart.
    objectiveAreaRef.current.setArea(objectiveAreaStateRef.current);
    groupDrag.setBoats(initialMapBoatsRef.current);
    groupDrag.setSelection(
      initialMapBoatsRef.current.filter((boat) => boat.selected).map((boat) => boat.id),
    );

    return () => {
      groupDragRef.current = null;
      perimeterHandlesRef.current?.destroy();
      perimeterHandlesRef.current = null;
      objectiveAreaRef.current?.destroy();
      objectiveAreaRef.current = null;
      groupDrag.destroy();
      detachErrors();
      flownToRef.current = null;
      map.off("click", onChartClick);
      map.off("mousemove", onChartHover);
      map.off("mouseout", onChartLeave);
      map.off("contextmenu", onChartContextMenu);
      canvas.removeEventListener("pointerdown", onMiddleDown);
      canvas.removeEventListener("pointermove", onMiddleMove);
      canvas.removeEventListener("pointerup", onMiddleUp);
      canvas.removeEventListener("pointercancel", onMiddleUp);
      canvas.removeEventListener("auxclick", blockAutoScroll);
      canvas.removeEventListener("mousedown", blockAutoScroll);
      markers.forEach((marker) => marker.remove());
      markers.clear();
      objectiveMarkerRef.current?.remove();
      objectiveMarkerRef.current = null;
      layerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
    // `dispatch` is stable for the life of the store, so the map is built once
    // rather than torn down whenever React re-creates the callback identity.
  }, [accessToken, dispatch]);

  // Traffic is pulled on its own clock rather than the simulation's: the service
  // rebuilds tiles every 10s, so asking faster only spends quota. Each pull
  // reports what the loaded tiles now carry, which is what tasking reads.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;

    // The live map is read on every tick rather than captured once. A
    // development remount rebuilds the map, and a removed map has no style, so
    // a captured handle throws inside getSource on the next interval.
    // The live map is read on every tick rather than captured once, because a
    // remount rebuilds it. The guard is "did this throw", NOT `isStyleLoaded()`:
    // a source that reloads every 15s keeps the style perpetually un-loaded, so
    // that check silently suppressed every publish and the console stayed clean
    // while traffic read as zero contacts.
    const publish = () => {
      const live = mapRef.current;
      if (!live) return;

      try {
        contactsRef.current?.(readAisContacts(live));
      } catch {
        // The map was torn down between the tick and the read.
      }
    };
    const refresh = () => {
      const live = mapRef.current;
      if (!live) return;

      try {
        const source = live.getSource(AIS_SOURCE);
        if (source && "reload" in source) (source as { reload: () => void }).reload();
      } catch {
        // Same: a removed map has no style to reload a source on.
      }
    };

    // Not `idle`: the 3D vessel layer repaints every frame, so a map carrying a
    // moving fleet never goes idle and an idle-driven publish never fires.
    // `sourcedata` tells us when AIS tiles have actually landed.
    const onSourceData = (event: mapboxgl.MapSourceDataEvent) => {
      if (event.sourceId === AIS_SOURCE && event.isSourceLoaded) publish();
    };

    map.on("sourcedata", onSourceData);
    const timer = setInterval(() => {
      refresh();
      publish();
    }, AIS_REFRESH_MS);

    return () => {
      clearInterval(timer);
      map.off("sourcedata", onSourceData);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(AIS_LAYERS.hull)) return;

    map.setFilter(AIS_LAYERS.target, targetMmsi === null
      ? ["==", ["get", "mmsi"], -1]
      : ["==", ["get", "mmsi"], targetMmsi]);
  }, [targetMmsi]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!objective || !showObjective) {
      objectiveMarkerRef.current?.remove();
      objectiveMarkerRef.current = null;
      return;
    }

    if (!objectiveMarkerRef.current) {
      const element = document.createElement("div");
      element.className = "objective-pin";
      // A dropped pin, not a crosshair: the tip marks the point, and the body
      // is loud enough to find against chart, traffic and depth shading alike.
      element.innerHTML = [
        '<svg class="objective-pin-mark" viewBox="0 0 24 33" aria-hidden="true">',
        '<path class="objective-pin-body" d="M12 1.5c-5.8 0-10.5 4.7-10.5 10.5 0 7.9 10.5 19.5 10.5 19.5S22.5 19.9 22.5 12C22.5 6.2 17.8 1.5 12 1.5z"/>',
        '<circle class="objective-pin-core" cx="12" cy="12" r="4.1"/>',
        '</svg>',
        '<span class="objective-pin-label">Objective</span>',
      ].join("");
      const marker = new mapboxgl.Marker({ element, anchor: "bottom", draggable: true })
        .setLngLat([objective.longitude, objective.latitude])
        .addTo(map);

      // Dragging the pin is the quickest way to move an objective, and it
      // reads as direct manipulation rather than "click somewhere else".
      marker.on("dragstart", () => {
        element.classList.add("is-dragging");
      });
      marker.on("dragend", () => {
        element.classList.remove("is-dragging");
        const moved = marker.getLngLat();
        objectiveRef.current?.({ latitude: moved.lat, longitude: moved.lng });
      });

      objectiveMarkerRef.current = marker;
      return;
    }

    objectiveMarkerRef.current.setLngLat([objective.longitude, objective.latitude]);
  }, [objective, showObjective]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      if (accessToken) {
        try {
          // The day basemap paints land close to white, which left the console's
          // own panels reading as the dim thing on the screen. Land drops to a
          // neutral just under the panels, so the brightest surface in light
          // mode is an overlay the operator put there, not the ground.
          setBasemapTheme(map, theme);
        } catch (error) {
          // A style without the standard basemap config keeps its own, but a
          // silent catch here once hid the basemap refusing to change at all.
          console.warn("basemap config refused", error);
        }
      }

      // Seamarks, lights and the live traffic names, which carry their own ink
      // rather than the basemap's.
      setOpenWatersTheme(map, theme);


      setSeascapeTheme(map, theme);

      if (map.getLayer("mission-route-lines")) {
        map.setPaintProperty("mission-route-lines", "line-color", routeColour(theme));
        map.setPaintProperty("mission-route-lines", "line-emissive-strength", emissive(theme));
      }

      if (map.getLayer("mission-route-points")) {
        map.setPaintProperty("mission-route-points", "circle-stroke-color", routeColour(theme));
        map.setPaintProperty("mission-route-points", "circle-emissive-strength", emissive(theme));
      }

      objectiveAreaRef.current?.setTheme(theme);
    };

    const safeApply = () => {
      try {
        apply();
      } catch {
        // A style mid-swap simply picks it up on the next style.load.
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

    if (!map || !focus) {
      setFocusPoint(null);
      return undefined;
    }

    const place = () => {
      const projected = map.project([focus.longitude, focus.latitude]);
      setFocusPoint({ x: projected.x, y: projected.y });
    };

    place();
    map.on("move", place);
    return () => {
      map.off("move", place);
    };
  }, [focus]);

  useEffect(() => {
    perimeterHandlesRef.current?.setShapes(perimeters);

    // A 1.5 NM ring at harbour zoom is wider than the viewport, so a newly
    // raised perimeter reads as an arc drifting past rather than as a circle.
    // Fit the camera to it once, when it appears, and never again — refitting
    // on every reshape would fight the operator's own drag.
    const map = mapRef.current;
    const fresh = perimeters.find((shape) => !seenPerimetersRef.current.has(shape.id));
    seenPerimetersRef.current = new Set(perimeters.map((shape) => shape.id));

    if (map && fresh) {
      // The dock overlays the lower half of the chart, so an even padding
      // would fit the ring to glass the operator cannot see through.
      map.fitBounds(perimeterBounds(fresh), {
        padding: { top: 120, right: 120, bottom: 460, left: 120 },
        duration: 900,
        maxZoom: 15,
      });
    }
  }, [perimeters]);

  // Everything the objective owns, pushed as one shape: the ground it claims
  // and a leader to each hull working it.
  useEffect(() => {
    const area: ObjectiveArea | null = objective && showObjective
      ? {
        center: objective,
        radiusNm,
        // A route's first coordinate is the hull it belongs to, so the tasked
        // fleet is already in hand rather than re-derived from the boat list.
        tasked: routes.map((route) => ({
          longitude: route.coordinates[0][0],
          latitude: route.coordinates[0][1],
        })),
      }
      : null;

    objectiveAreaStateRef.current = area;
    objectiveAreaRef.current?.setArea(area);
  }, [objective, showObjective, radiusNm, routes]);

  useEffect(() => {
    routesRef.current = routes;
    const source = mapRef.current?.getSource("mission-routes") as GeoJSONSource | undefined;
    source?.setData(routeData(routes, groupColours));
  }, [routes, groupColours]);

  useEffect(() => {
    mapBoatsRef.current = mapBoats;
    layerRef.current?.setBoats(mapBoats);
    const map = mapRef.current;
    if (!map || mapBoats.length === 0) return;

    const activeIds = new Set(mapBoats.map((boat) => boat.id));
    markersRef.current.forEach((marker, boatId) => {
      if (!activeIds.has(boatId)) {
        marker.remove();
        markersRef.current.delete(boatId);
      }
    });

    mapBoats.forEach((boat, boatIndex) => {
      let marker = markersRef.current.get(boat.id);

      if (!marker) {
        const element = document.createElement("div");
        const select = document.createElement("button");

        element.className = "boat-map-marker";
        select.className = "boat-map-marker-select";
        select.type = "button";
        select.setAttribute("aria-label", `Select ${boat.name}`);
        // The visible plate is a Three.js sprite attached to the boat. This
        // transparent DOM control keeps the same accessible/selectable hitbox.
        // which also reads shift-click; this keeps the label keyboard-usable.
        // A marker is DOM, not canvas, so `map.on("click")` never sees it. The
        // overlay therefore has to be raised from the marker itself.
        const raiseFocus = () => {
          const live = mapBoatsRef.current.find((item) => item.id === boat.id);
          if (!live) return;

          focusRef.current?.({
            kind: "BOAT",
            id: live.id,
            title: live.name,
            subtitle: `${live.type} · ${live.id}`,
            longitude: live.longitude,
            latitude: live.latitude,
          });
        };

        select.addEventListener("click", (event) => {
          // Pointer selection belongs to the drag controller, which only picks
          // on a press that stays put. Keyboard has no such press to read.
          if (event.detail === 0) selectRef.current?.(boat.id);
          raiseFocus();
        });
        element.append(select);

        marker = new mapboxgl.Marker({ element, anchor: "bottom" })
          .setLngLat([boat.longitude, boat.latitude])
          .addTo(map);
        markersRef.current.set(boat.id, marker);

        groupDragRef.current?.attachHandle(boat.id, select);
      }

      const element = marker.getElement();

      marker.setLngLat([boat.longitude, boat.latitude]);
      // The hull carries its group's hue; CSS falls back to the fleet accent
      // when a boat belongs to no group.
      const colour = colourRef.current.get(boat.id);
      if (colour) element.style.setProperty("--group-colour", colour);
      else element.style.removeProperty("--group-colour");
      element.classList.toggle("is-grouped-colour", Boolean(colour));
      element.classList.toggle("is-selected", boat.selected);
      element.classList.toggle("is-grouped", group.has(boat.id));
      element.classList.toggle("is-link-lost", boat.linkLost === true);
    });

    groupDragRef.current?.setTool(tool);
    groupDragRef.current?.setBoats(mapBoats);
  }, [mapBoats, group, tool]);

  useEffect(() => {
    groupDragRef.current?.setSelection(dragIds);
  }, [dragIds]);

  // Overview holds the whole fleet in frame, because that is the state the
  // orchestration bar works in. Outside overview the camera follows the tasked
  // vessel; position updates do not re-fly, only a change of selection does.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (overview) {
      const bounds = fleetBounds(mapBoatsRef.current);
      flownToRef.current = null;
      if (bounds) {
        map.fitBounds(bounds, { padding: 160, pitch: 46, duration: 900, maxZoom: 14.4 });
      }
      return;
    }

    const boat = mapBoatsRef.current.find((item) => item.id === selectedBoatId);
    if (!boat || flownToRef.current === selectedBoatId) return;

    flownToRef.current = selectedBoatId;
    map.flyTo({
      center: [boat.longitude, boat.latitude],
      zoom: Math.max(map.getZoom(), 16.2),
      pitch: 58,
      duration: 1100,
      essential: true,
    });
  }, [selectedBoatId, overview]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      for (const id of SEASCAPE_LAYERS) {
        if (!map.getLayer(id)) continue;
        map.setLayoutProperty(id, "visibility", seascape ? "visible" : "none");
      }
    };

    const safeApply = () => {
      try {
        apply();
      } catch {
        // Layers not built yet; style.load will run this again.
      }
    };

    safeApply();
    map.on("style.load", safeApply);
    return () => {
      map.off("style.load", safeApply);
    };
  }, [seascape]);

  // The chosen squares stay drawn whatever tool is in hand; the candidate grid
  // only appears while the survey tool does, and follows the viewport, because
  // a world-sized grid is neither drawable nor useful.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;

    const paint = () => {
      if (!map.getSource(SURVEY_SOURCE)) return;

      const chosen = map.getSource(SURVEY_SOURCE) as mapboxgl.GeoJSONSource;
      chosen.setData(surveyData(surveyCells, surveySizeNm));

      const surveying = tool === "SURVEY";
      map.setLayoutProperty(SURVEY_GRID_LINE, "visibility", surveying ? "visible" : "none");
      if (!surveying) return;

      const view = map.getBounds();
      if (!view) return;

      const grid = map.getSource(SURVEY_GRID_SOURCE) as mapboxgl.GeoJSONSource;
      grid.setData(surveyGridData({
        west: view.getWest(),
        east: view.getEast(),
        south: view.getSouth(),
        north: view.getNorth(),
      }, surveyCells, surveySizeNm));
    };

    if (map.isStyleLoaded()) paint();
    map.on("style.load", paint);
    map.on("moveend", paint);

    return () => {
      map.off("style.load", paint);
      map.off("moveend", paint);
    };
  }, [surveyCells, surveySizeNm, tool]);

  return (
    <section className="map-shell" aria-label="Splash fleet operations map">
      <div ref={containerRef} className="map-canvas" data-map-engine="mapbox-gl" />
      <div className="map-vignette" aria-hidden="true" />
      {focus && focusPoint && (
        <ChartActions
          focus={focus}
          x={focusPoint.x}
          y={focusPoint.y}
          actions={focusActions}
          onDismiss={dismissFocus}
        />
      )}

      <div className="chart-control">
        <button
          className={`chart-toggle${seascape ? " is-live" : ""}`}
          type="button"
          onClick={onToggleSeascape}
          aria-pressed={seascape}
          aria-label="Depth and terrain"
          title="Depth and terrain — Open Waters Seascape, context only, not charted depths"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2 8 Q7 5 12 8 T22 8" />
            <path d="M2 13 Q7 10 12 13 T22 13" />
            <path d="M2 18 Q7 15 12 18 T22 18" />
          </svg>
        </button>

        <button
          className="chart-toggle"
          type="button"
          onClick={onToggleTheme}
          aria-pressed={theme === "LIGHT"}
          aria-label={theme === "LIGHT" ? "Switch to dark" : "Switch to light"}
          title={theme === "LIGHT" ? "Switch to dark" : "Switch to light"}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {theme === "LIGHT" ? (
              <path d="M20 14.5A8 8 0 0 1 9.5 4a8.3 8.3 0 1 0 10.5 10.5Z" />
            ) : (
              <>
                <circle cx={12} cy={12} r={4.2} />
                <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
              </>
            )}
          </svg>
        </button>
      </div>

    </section>
  );
}
