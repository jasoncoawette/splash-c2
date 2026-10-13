import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { BoatId } from "../core/types";

export type ScenarioPhase =
  | "BRIEF"
  | "READY"
  | "ACTIVE"
  | "LINK_LOST"
  | "ACKNOWLEDGED"
  | "RESOLVED";

export type LinkState = "ONLINE" | "LOST";

/**
 * Where each phase sits in the five-step script. The ordering is the scenario,
 * not a detail of the panel that draws it: the chart toolbar reports the same
 * step on its switch, and both read it from here.
 */
export const SCENARIO_PHASE_INDEX: Record<ScenarioPhase, number> = {
  BRIEF: 0,
  READY: 1,
  ACTIVE: 2,
  LINK_LOST: 3,
  ACKNOWLEDGED: 4,
  RESOLVED: 5,
};

export const SCENARIO_STEP_COUNT = 5;

/** The step an operator would read off the rail: 1 through 5, never 6. */
export function scenarioStep(phase: ScenarioPhase): number {
  return Math.min(SCENARIO_PHASE_INDEX[phase] + 1, SCENARIO_STEP_COUNT);
}

export interface ScenarioEvent {
  id: string;
  label: string;
  tone: "NORMAL" | "ALERT" | "ACTION";
}

export interface ScenarioState {
  /**
   * Whether the guided workflow is on the screen. It is a separate axis from
   * the phase on purpose: closing the coach must not throw away the step the
   * operator has reached, and re-opening it must not restart the mission.
   */
  open: boolean;
  phase: ScenarioPhase;
  affectedBoatId: BoatId;
  links: Record<BoatId, LinkState>;
  events: ScenarioEvent[];
}

const initialState: ScenarioState = {
  open: false,
  phase: "BRIEF",
  affectedBoatId: "typhoon-02",
  links: {},
  events: [],
};

const scenarioSlice = createSlice({
  name: "scenario",
  initialState,
  reducers: {
    /** Omit the payload to flip the coach; pass a value to set it outright. */
    scenarioToggled(state, action: PayloadAction<boolean | undefined>) {
      state.open = action.payload ?? !state.open;
    },

    scenarioOpened(state) {
      state.open = true;
    },

    scenarioClosed(state) {
      state.open = false;
    },

    scenarioPrepared(state, action: PayloadAction<readonly BoatId[]>) {
      state.phase = "READY";
      state.links = Object.fromEntries(action.payload.map((boatId) => [boatId, "ONLINE"]));
      state.events = [{ id: "selection", label: "Three-vessel team selected", tone: "ACTION" }];
    },
    scenarioMissionLaunched(state) {
      state.phase = "ACTIVE";
      state.events.push({ id: "mission", label: "Harbor patrol underway", tone: "NORMAL" });
    },
    scenarioLinkLost(state) {
      state.phase = "LINK_LOST";
      state.links[state.affectedBoatId] = "LOST";
      state.events.push({ id: "link-loss", label: "TY-02 command link lost", tone: "ALERT" });
    },
    scenarioAlertAcknowledged(state) {
      state.phase = "ACKNOWLEDGED";
      state.events.push({ id: "ack", label: "Alert acknowledged by operator", tone: "ACTION" });
    },
    scenarioResolved(state) {
      state.phase = "RESOLVED";
      state.events.push({ id: "resolve", label: "Remaining pair re-tasked", tone: "NORMAL" });
    },
    /**
     * Rewind the workflow to the brief. `open` survives: a replay is a step
     * inside the demo, and the panel the operator is reading stays put.
     */
    scenarioReset(state) {
      return { ...initialState, open: state.open, links: {}, events: [] };
    },
  },
});

export const {
  scenarioAlertAcknowledged,
  scenarioClosed,
  scenarioLinkLost,
  scenarioMissionLaunched,
  scenarioOpened,
  scenarioPrepared,
  scenarioReset,
  scenarioResolved,
  scenarioToggled,
} = scenarioSlice.actions;

export default scenarioSlice.reducer;
