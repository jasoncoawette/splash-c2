import mapboxgl, { type Map as MapboxMap } from "mapbox-gl";
import { advanceAlongHeading, distanceBetween } from "../../core/navigation.ts";
import type { Position } from "../../core/types";

/**
 * PERIMETER RINGS
 *
 * Drawn as geodesic circles so a ring is the same number of nautical miles all
 * the way round, rather than a screen-space circle that lies about its size.
 *
 * The drag follows the pattern the group-drag controller established: claim the
 * press with `stopPropagation`, turn the map's own pan off for the gesture, and
 * hand the trailing click back to that controller so a release never drops an
 * objective pin where the drag finished.
 */

export const PERIMETER_SOURCE = "splash-perimeters";
export const PERIMETER_FILL = "splash-perimeter-fill";
export const PERIMETER_LINE = "splash-perimeter-line";
export interface PerimeterShape {
  id: string;
  name: string;
  center: Position;
  radiusNm: number;
  active: boolean;
  boatCount: number;
}

/** Shared with the objective area, so one ring maths serves every circle. */
export function ringCoordinates(center: Position, radiusNm: number, steps = 72) {
  const coordinates: [number, number][] = [];

  for (let step = 0; step <= steps; step += 1) {
    const point = advanceAlongHeading(center, (360 / steps) * step, radiusNm);
    coordinates.push([point.longitude, point.latitude]);
  }

  return coordinates;
}

/** The ring's extent, so the camera can be fitted to a newly raised perimeter. */
export function perimeterBounds(shape: PerimeterShape): [[number, number], [number, number]] {
  const north = advanceAlongHeading(shape.center, 0, shape.radiusNm);
  const east = advanceAlongHeading(shape.center, 90, shape.radiusNm);
  const south = advanceAlongHeading(shape.center, 180, shape.radiusNm);
  const west = advanceAlongHeading(shape.center, 270, shape.radiusNm);

  return [
    [west.longitude, south.latitude],
    [east.longitude, north.latitude],
  ];
}

export function perimeterData(shapes: readonly PerimeterShape[]) {
  return {
    type: "FeatureCollection" as const,
    features: shapes.map((shape) => ({
      type: "Feature" as const,
      properties: { id: shape.id, active: shape.active ? 1 : 0 },
      geometry: {
        type: "Polygon" as const,
        coordinates: [ringCoordinates(shape.center, shape.radiusNm)],
      },
    })),
  };
}

export function addPerimeterLayers(map: MapboxMap): void {
  if (map.getSource(PERIMETER_SOURCE)) return;

  map.addSource(PERIMETER_SOURCE, {
    type: "geojson",
    data: perimeterData([]),
  });

  map.addLayer({
    id: PERIMETER_FILL,
    type: "fill",
    slot: "top",
    source: PERIMETER_SOURCE,
    paint: {
      // Orange ground, red rim: a perimeter is the one thing on this chart that
      // is an instruction rather than information, so it does not share the
      // cyan every reading on the chart is drawn in.
      "fill-color": "#ff8c42",
      // Faint enough to read the chart through, strong enough to exist. The
      // earlier values sat under the depth contours, so the ring lost to its
      // own context.
      "fill-opacity": ["case", ["==", ["get", "active"], 1], 0.13, 0.06],
    },
  });

  map.addLayer({
    id: PERIMETER_LINE,
    type: "line",
    slot: "top",
    source: PERIMETER_SOURCE,
    paint: {
      "line-color": ["case", ["==", ["get", "active"], 1], "#ff3b2f", "#ff9f4a"],
      "line-width": ["case", ["==", ["get", "active"], 1], 3, 1.8],
      "line-opacity": 1,
    },
  });

}

export interface PerimeterHandles {
  setShapes: (shapes: readonly PerimeterShape[] | undefined) => void;
  destroy: () => void;
}

interface HandleHost {
  map: MapboxMap;
  onReshape: (id: string, shape: { center?: Position; radiusNm?: number }) => void;
  onSelect: (id: string) => void;
  /** Hands the trailing click to the group-drag controller to swallow. */
  onGestureEnd: () => void;
}

/**
 * Two markers per ring: one at the centre to move it, one on the rim to resize
 * it. Markers rather than canvas hit-testing, so the handles stay reachable at
 * any zoom and keyboard focus has something real to land on.
 */
export function createPerimeterHandles(host: HandleHost): PerimeterHandles {
  const { map, onReshape, onSelect, onGestureEnd } = host;
  const centres = new Map<string, mapboxgl.Marker>();
  const rims = new Map<string, mapboxgl.Marker>();
  let shapes: PerimeterShape[] = [];

  function shapeOf(id: string) {
    return shapes.find((shape) => shape.id === id) ?? null;
  }

  function drag(
    element: HTMLElement,
    id: string,
    onMove: (lngLat: mapboxgl.LngLat, shape: PerimeterShape) => void,
  ) {
    element.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      event.preventDefault();
      onSelect(id);
      map.dragPan.disable();
      // The one cursor owner is cursors.css, which reads this flag off the
      // body so the cursor holds when the pointer leaves the handle mid-drag.
      document.body.dataset.chartDrag = "drag";
      element.setPointerCapture(event.pointerId);

      const move = (moveEvent: PointerEvent) => {
        const shape = shapeOf(id);
        if (!shape) return;

        const rect = map.getCanvas().getBoundingClientRect();
        onMove(
          map.unproject([moveEvent.clientX - rect.left, moveEvent.clientY - rect.top]),
          shape,
        );
      };

      const up = () => {
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerup", up);
        element.removeEventListener("pointercancel", up);
        map.dragPan.enable();
        delete document.body.dataset.chartDrag;
        onGestureEnd();
      };

      element.addEventListener("pointermove", move);
      element.addEventListener("pointerup", up);
      element.addEventListener("pointercancel", up);
    });
  }

  function ensure(shape: PerimeterShape) {
    if (!centres.has(shape.id)) {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "perimeter-handle is-centre";
      element.innerHTML = '<span class="perimeter-handle-dot"></span><span class="perimeter-handle-name"></span>';
      drag(element, shape.id, (lngLat) => onReshape(shape.id, {
        center: { latitude: lngLat.lat, longitude: lngLat.lng },
      }));
      centres.set(
        shape.id,
        new mapboxgl.Marker({ element, anchor: "center" })
          .setLngLat([shape.center.longitude, shape.center.latitude])
          .addTo(map),
      );
    }

    if (!rims.has(shape.id)) {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "perimeter-handle is-rim";
      element.setAttribute("aria-label", `Resize ${shape.name}`);
      drag(element, shape.id, (lngLat, current) => onReshape(shape.id, {
        radiusNm: distanceBetween(current.center, {
          latitude: lngLat.lat,
          longitude: lngLat.lng,
        }),
      }));
      rims.set(
        shape.id,
        new mapboxgl.Marker({ element, anchor: "center" })
          .setLngLat([shape.center.longitude, shape.center.latitude])
          .addTo(map),
      );
    }
  }

  function place(shape: PerimeterShape) {
    const centre = centres.get(shape.id);
    const rim = rims.get(shape.id);
    // The rim handle sits due east of the centre, which keeps it predictable
    // whatever the camera bearing is doing.
    const rimPoint = advanceAlongHeading(shape.center, 90, shape.radiusNm);

    centre?.setLngLat([shape.center.longitude, shape.center.latitude]);
    rim?.setLngLat([rimPoint.longitude, rimPoint.latitude]);

    const centreElement = centre?.getElement();
    if (centreElement) {
      centreElement.classList.toggle("is-active", shape.active);
      const name = centreElement.querySelector(".perimeter-handle-name");
      if (name) name.textContent = `${shape.name} · ${shape.boatCount}`;
    }
    rim?.getElement().classList.toggle("is-active", shape.active);
  }

  return {
    setShapes(next) {
      // A hot reload can hand this an undefined slice before the store has
      // rehydrated, and a chart overlay is never worth taking the view down for.
      shapes = next ? [...next] : [];
      const live = new Set(shapes.map((shape) => shape.id));

      for (const [id, marker] of centres) {
        if (!live.has(id)) {
          marker.remove();
          centres.delete(id);
        }
      }
      for (const [id, marker] of rims) {
        if (!live.has(id)) {
          marker.remove();
          rims.delete(id);
        }
      }

      for (const shape of shapes) {
        ensure(shape);
        place(shape);
      }

      const source = map.getSource(PERIMETER_SOURCE);
      if (source && "setData" in source) {
        (source as mapboxgl.GeoJSONSource).setData(perimeterData(shapes));
      }
    },

    destroy() {
      centres.forEach((marker) => marker.remove());
      rims.forEach((marker) => marker.remove());
      centres.clear();
      rims.clear();
    },
  };
}
