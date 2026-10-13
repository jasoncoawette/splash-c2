import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { BoatId, Position } from "../core/types";
import { GROUP_NAMES, INITIAL_BOATS } from "./seed.ts";

// OPERATOR INTENT
//
// What the operator has selected, opened and dialled in. Kept apart from the
// fleet on purpose: selecting a boat is not a fleet transition, and a replay of
// the fleet must not depend on which panel happened to be open.
//
// Grouping has no control on screen any more — the ledger deleted the button
// and the chips, because shift-click already said it. The reducer and its test
// stay: a group is still a thing the chart can colour, and nothing is cheaper
// to keep than a pure reducer nobody dispatches.
export interface FleetGroup {
  id: string;
  name: string;
  boatIds: readonly string[];
}

export type ConsoleView = "FLEET" | "HELM";

/**
 * Which camera the helm is watching. Each one is a real mount on the hull the
 * map draws: the bow camera, the gimballed electro-optical turret on the mast,
 * and the transom camera over the drive. Declared here for the same reason as
 * DockSide — the store owns the state, so the view imports the type.
 */
/** Which chart tool a click on the water means. */
export type ChartTool = "SELECT" | "OBJECTIVE" | "PERIMETER" | "ESCORT" | "SURVEY";

export type HelmCamera = "BOW" | "MAST" | "AFT" | "EXTERNAL";

/** Where the external camera sits relative to the boat it is watching. */
export interface OrbitState {
  /** Degrees around the hull from dead astern, clockwise. */
  yawDegrees: number;
  /** Degrees above the waterline. */
  pitchDegrees: number;
  /** Metres from the hull. */
  distanceM: number;
}

/**
 * Engine telegraph positions, as fractions of the platform's rated speed. The
 * simulator refuses a negative throttle, so there is no astern notch.
 */
/**
 * The engine telegraph, as fractions of the hull's rated speed. Astern is a
 * real order rather than a negative accident, and stops short of full: a demo
 * assumption that a boat makes about a third of its speed going backwards,
 * which the ledger records as an assumption until platform data says otherwise.
 */
export const THROTTLE_NOTCHES: readonly number[] = [-0.35, -0.175, 0, 0.25, 0.5, 0.75, 1];

export const THROTTLE_LABELS: readonly string[] = [
  "ASTERN FULL",
  "ASTERN SLOW",
  "STOP",
  "AHEAD 1/4",
  "AHEAD 1/2",
  "AHEAD 3/4",
  "AHEAD FULL",
];

/** Where the telegraph rests: STOP, which is no longer the first position. */
export const THROTTLE_STOP_INDEX = 2;

/** Degrees of rudder per key press, and the stops either side. */
export const RUDDER_STEP = 5;
export const RUDDER_LIMIT = 35;

export interface CommandSliceState {
  selectedBoatId: string;
  selectedIds: string[];
  groups: FleetGroup[];
  view: ConsoleView;
  /** The vessel list down the left. */
  fleetPanelOpen: boolean;
  /** The detail panel on the right, which opens when a vessel is selected. */
  detailPanelOpen: boolean;
  /**
   * Which part of the hull has its telemetry window open, by `SubsystemId`.
   *
   * Held as strings for the same reason FleetGroup is matched structurally:
   * the store does not import from a component, and the id list is owned by
   * the drawing that pins the windows.
   *
   * One set for the console rather than one per vessel: an operator watching
   * the drives wants to keep watching the drives when they look at the next
   * hull, and a window for a part a class does not carry simply has no pin.
   */
  openSubsystems: string[];
  helmCamera: HelmCamera;
  chartTool: ChartTool;
  orbit: OrbitState;
  /** Index into THROTTLE_NOTCHES: the telegraph position, not the speed. */
  throttleNotch: number;
  /** Terrain contours drawn under the fleet. */
  chartTerrain: boolean;
  /** Null once the operator deletes it; orders that need a centre no-op. */
  objective: Position | null;
  radiusNm: number;
  cruiseKnots: number;
  simRate: number;
  rudderDegrees: number;
}

const initialState: CommandSliceState = {
  selectedBoatId: INITIAL_BOATS[0].definition.id,
  selectedIds: INITIAL_BOATS.map((seed) => seed.definition.id),
  groups: [],
  view: "FLEET",
  fleetPanelOpen: true,
  detailPanelOpen: true,
  openSubsystems: ["DRIVE"],
  helmCamera: "EXTERNAL",
  chartTool: "SELECT",
  orbit: { yawDegrees: 24, pitchDegrees: 16, distanceM: 26 },
  throttleNotch: THROTTLE_STOP_INDEX,
  chartTerrain: true,
  objective: { latitude: 33.712, longitude: -118.229 },
  radiusNm: 1.5,
  cruiseKnots: 22,
  simRate: 4,
  rudderDegrees: 0,
};

const commandSlice = createSlice({
  name: "command",
  initialState,
  reducers: {
    /** Selecting a vessel is what opens its detail panel. */
    boatSelected(state, action: PayloadAction<string>) {
      state.selectedBoatId = action.payload;
      state.detailPanelOpen = true;
    },

    /** Omit the payload to flip the panel; pass a value to set it outright. */
    fleetPanelToggled(state, action: PayloadAction<boolean | undefined>) {
      state.fleetPanelOpen = action.payload ?? !state.fleetPanelOpen;
    },

    detailPanelToggled(state, action: PayloadAction<boolean | undefined>) {
      state.detailPanelOpen = action.payload ?? !state.detailPanelOpen;
    },

    /** Open or close one part's telemetry window. Any number may be open. */
    subsystemToggled(state, action: PayloadAction<string>) {
      const id = action.payload;
      state.openSubsystems = state.openSubsystems.includes(id)
        ? state.openSubsystems.filter((open) => open !== id)
        : [...state.openSubsystems, id];
    },

    /** Open a named set, or clear the lot: what "all" and "none" dispatch. */
    subsystemsSet(state, action: PayloadAction<readonly string[]>) {
      state.openSubsystems = [...action.payload];
    },

    /**
     * Replace the group, in selection order; the last boat becomes the lead.
     *
     * Selecting anything opens the detail panel, the same as `boatSelected`:
     * the rule belongs to selection, not to the surface the selection came
     * from, so the list and the chart cannot drift apart. Clearing is not a
     * selection and must not pop an empty panel open.
     */
    boatsSelected(state, action: PayloadAction<readonly string[]>) {
      state.selectedIds = [...action.payload];
      const lead = action.payload[action.payload.length - 1];
      if (!lead) return;

      state.selectedBoatId = lead;
      state.detailPanelOpen = true;
    },

    boatToggled(state, action: PayloadAction<string>) {
      const boatId = action.payload;
      state.selectedIds = state.selectedIds.includes(boatId)
        ? state.selectedIds.filter((id) => id !== boatId)
        : [...state.selectedIds, boatId];
      state.selectedBoatId = boatId;
    },

    /** Drop a removed boat from the selection, every group, and the lead slot. */
    boatForgotten(
      state,
      action: PayloadAction<{ boatId: BoatId; nextSelectedId: string }>,
    ) {
      const { boatId, nextSelectedId } = action.payload;
      state.selectedIds = state.selectedIds.filter((id) => id !== boatId);
      state.groups = state.groups
        .map((group) => ({
          ...group,
          boatIds: group.boatIds.filter((id) => id !== boatId),
        }))
        .filter((group) => group.boatIds.length > 0);

      if (state.selectedBoatId !== boatId) return;
      state.selectedBoatId = nextSelectedId;
      if (nextSelectedId === "") state.view = "FLEET";
    },

    groupFormed(state) {
      if (state.selectedIds.length === 0) return;
      const index = state.groups.length;
      state.groups.push({
        id: `group-${index + 1}`,
        name: `Group ${GROUP_NAMES[index % GROUP_NAMES.length]}`,
        boatIds: [...state.selectedIds],
      });
    },

    viewChanged(state, action: PayloadAction<ConsoleView>) {
      state.view = action.payload;
      // Zooming into a boat should show the boat and what is around it; the
      // bow camera sits inside the superstructure and opens on empty sea.
      if (action.payload === "HELM") state.helmCamera = "EXTERNAL";
    },


    /**
     * Pick a chart tool. Dropping back to SELECT after a placement is left to
     * the caller, so the return trip is visible at the call site rather than
     * hidden in here.
     */
    toolSelected(state, action: PayloadAction<ChartTool>) {
      state.chartTool = action.payload;
    },

    cameraSelected(state, action: PayloadAction<HelmCamera>) {
      state.helmCamera = action.payload;
    },

    /** Step the telegraph one notch, the way a W or S press does. */
    throttleStepped(state, action: PayloadAction<number>) {
      state.throttleNotch = Math.min(
        Math.max(state.throttleNotch + action.payload, 0),
        THROTTLE_NOTCHES.length - 1,
      );
    },

    throttleNotchSet(state, action: PayloadAction<number>) {
      state.throttleNotch = Math.min(
        Math.max(Math.round(action.payload), 0),
        THROTTLE_NOTCHES.length - 1,
      );
    },

    /** Swing the rudder a step to port or starboard, against its stops. */
    rudderStepped(state, action: PayloadAction<number>) {
      const next = state.rudderDegrees + action.payload * RUDDER_STEP;
      state.rudderDegrees = Math.min(Math.max(next, -RUDDER_LIMIT), RUDDER_LIMIT);
    },

    rudderCentred(state) {
      state.rudderDegrees = 0;
    },

    orbitMoved(state, action: PayloadAction<Partial<OrbitState>>) {
      const { yawDegrees, pitchDegrees, distanceM } = action.payload;
      if (yawDegrees !== undefined) {
        state.orbit.yawDegrees = ((yawDegrees % 360) + 360) % 360;
      }
      if (pitchDegrees !== undefined) {
        state.orbit.pitchDegrees = Math.min(Math.max(pitchDegrees, -4), 78);
      }
      if (distanceM !== undefined) {
        state.orbit.distanceM = Math.min(Math.max(distanceM, 9), 180);
      }
    },

    chartTerrainToggled(state, action: PayloadAction<boolean | undefined>) {
      state.chartTerrain = action.payload ?? !state.chartTerrain;
    },


    objectiveCleared(state) {
      state.objective = null;
    },

    objectiveMoved(state, action: PayloadAction<Position>) {
      state.objective = action.payload;
    },

    radiusChanged(state, action: PayloadAction<number>) {
      state.radiusNm = action.payload;
    },

    cruiseChanged(state, action: PayloadAction<number>) {
      state.cruiseKnots = action.payload;
    },

    simRateChanged(state, action: PayloadAction<number>) {
      state.simRate = action.payload;
    },

    rudderOrdered(state, action: PayloadAction<number>) {
      state.rudderDegrees = action.payload;
    },

    commandReset() {
      return {
        ...initialState,
        selectedIds: [...initialState.selectedIds],
        openSubsystems: [...initialState.openSubsystems],
        groups: [],
        orbit: { ...initialState.orbit },
        objective: initialState.objective ? { ...initialState.objective } : null,
      };
    },
  },
});

export const {
  cameraSelected,
  chartTerrainToggled,
  commandReset,
  orbitMoved,
  rudderCentred,
  rudderStepped,
  throttleNotchSet,
  throttleStepped,
  boatForgotten,
  boatSelected,
  boatToggled,
  boatsSelected,
  cruiseChanged,
  detailPanelToggled,
  fleetPanelToggled,
  groupFormed,
  objectiveCleared,
  objectiveMoved,
  radiusChanged,
  rudderOrdered,
  simRateChanged,
  subsystemToggled,
  subsystemsSet,
  toolSelected,
  viewChanged,
} = commandSlice.actions;

export default commandSlice.reducer;
