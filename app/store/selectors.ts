import { createSelector } from "@reduxjs/toolkit";
import type { BoatDefinition, BoatId, BoatState, Mission } from "../core/types";
import { summariseActivity, type ActivitySummary } from "./activity.ts";
import type { RootState } from "./index.ts";
import type { TelemetrySample } from "./telemetrySlice.ts";

// DERIVED VIEWS
//
// Every shape a panel needs is computed here, once, instead of in a useMemo per
// component. Nothing below writes to the store.

export interface BoatView {
  definition: BoatDefinition;
  state: BoatState;
}

export interface MapRouteView {
  id: string;
  boatId: string;
  coordinates: readonly (readonly [number, number])[];
  active: boolean;
}

export interface NeighbourView {
  id: string;
  name: string;
  type: BoatDefinition["type"];
  speedKnots: number;
  /** The contact's own course, so a 3D view can sit it at its true aspect. */
  headingDegrees: number;
  position: BoatState["position"];
}

export const selectFleet = (state: RootState) => state.fleet.fleet;
export const selectNotice = (state: RootState) => state.fleet.notice;
export const selectSelectedBoatId = (state: RootState) => state.command.selectedBoatId;
export const selectSelectedIds = (state: RootState) => state.command.selectedIds;
export const selectGroups = (state: RootState) => state.command.groups;
export const selectView = (state: RootState) => state.command.view;
export const selectFleetPanelOpen = (state: RootState) => state.command.fleetPanelOpen;
export const selectDetailPanelOpen = (state: RootState) => state.command.detailPanelOpen;
export const selectOpenSubsystems = (state: RootState) => state.command.openSubsystems;
export const selectHelmCamera = (state: RootState) => state.command.helmCamera;
export const selectChartTool = (state: RootState) => state.command.chartTool;
export const selectChartTerrain = (state: RootState) => state.command.chartTerrain;
export const selectOrbit = (state: RootState) => state.command.orbit;
export const selectThrottleNotch = (state: RootState) => state.command.throttleNotch;
export const selectObjective = (state: RootState) => state.command.objective;
export const selectRadiusNm = (state: RootState) => state.command.radiusNm;
export const selectCruiseKnots = (state: RootState) => state.command.cruiseKnots;
export const selectSimRate = (state: RootState) => state.command.simRate;
export const selectRudderDegrees = (state: RootState) => state.command.rudderDegrees;
export const selectElapsedSeconds = (state: RootState) => state.telemetry.elapsedSeconds;
export const selectTicks = (state: RootState) => state.telemetry.ticks;

export const selectBoatStates = createSelector(
  [selectFleet],
  (fleet): BoatState[] => Object.values(fleet.boats),
);

export const selectBoatViews = createSelector(
  [selectFleet],
  (fleet): BoatView[] => Object.values(fleet.boats).map((state) => ({
    state,
    definition: fleet.definitions[state.id],
  })),
);

export const selectSelectedBoat = createSelector(
  [selectFleet, selectSelectedBoatId],
  (fleet, boatId): BoatState | null => fleet.boats[boatId] ?? null,
);

export const selectSelectedDefinition = createSelector(
  [selectFleet, selectSelectedBoatId],
  (fleet, boatId): BoatDefinition | null => fleet.definitions[boatId] ?? null,
);

export const selectSelectedMission = createSelector(
  [selectFleet, selectSelectedBoat],
  (fleet, boat): Mission | null => (
    boat?.missionId ? fleet.missions[boat.missionId] ?? null : null
  ),
);

export const selectRoutes = createSelector(
  [selectBoatViews, selectFleet, selectSelectedBoatId, selectSelectedIds],
  (boats, fleet, selectedBoatId, selectedIds): MapRouteView[] => {
    const group = new Set(selectedIds);

    return boats
      .filter(({ state }) => state.missionId !== null)
      .map(({ state }) => {
        const mission = fleet.missions[state.missionId as string];
        const ahead = mission.waypoints.slice(state.waypointIndex);

        return {
          id: mission.id,
          boatId: state.id,
          coordinates: [
            [state.position.longitude, state.position.latitude] as const,
            ...ahead.map((point) => [point.longitude, point.latitude] as const),
          ],
          active: state.id === selectedBoatId || group.has(state.id),
        };
      });
  },
);

export const selectNeighbours = createSelector(
  [selectBoatViews, selectSelectedBoatId],
  (boats, selectedBoatId): NeighbourView[] => boats
    .filter(({ state }) => state.id !== selectedBoatId)
    .map(({ definition, state }) => ({
      id: state.id,
      name: definition.name,
      type: definition.type,
      speedKnots: state.speedKnots,
      headingDegrees: state.headingDegrees,
      position: state.position,
    })),
);

const EMPTY_HISTORY: readonly TelemetrySample[] = [];

/** Rolling samples for one boat, for an instrument that draws a trend. */
export function selectTelemetry(boatId: BoatId) {
  return (state: RootState): readonly TelemetrySample[] => (
    state.telemetry.history[boatId] ?? EMPTY_HISTORY
  );
}

export const selectLatestTelemetry = (boatId: BoatId) => (
  (state: RootState): TelemetrySample | null => {
    const samples = state.telemetry.history[boatId];
    return samples && samples.length > 0 ? samples[samples.length - 1] : null;
  }
);

/**
 * What the fleet is doing, for the activity window under the vessel list.
 *
 * Memoised on the four things it reads, so a tick that moves nobody does not
 * re-sort the list: the fleet, link state, escort assignments and the contact
 * names an escort line is written with.
 */
export const selectActivity = createSelector(
  [
    selectFleet,
    (state: RootState) => state.scenario.links,
    (state: RootState) => state.traffic.follows,
    (state: RootState) => state.traffic.contacts,
  ],
  (fleet, links, follows, contacts): ActivitySummary => summariseActivity(fleet, {
    links,
    follows,
    contacts,
  }),
);
