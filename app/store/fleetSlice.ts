import { createSlice, current, isDraft, type PayloadAction } from "@reduxjs/toolkit";
import type { MissionPattern } from "../core/missionPlanner.ts";
import type { BoatId, BoatType, Fleet, Position } from "../core/types";
import { planFollow, type FollowMode } from "../core/followTarget.ts";
import type { TrafficHazard } from "../core/separation.ts";
import { SAFETY_MARGIN_NM, hullRadiusNm } from "../core/hull.ts";
import { distanceBetween } from "../core/navigation.ts";
import { planMission } from "../core/missionPlanner.ts";
import {
  addBoatToFleet,
  createFleet,
  followFleetTarget,
  holdBoat,
  recallBoat,
  retargetMission,
  removeBoatFromFleet,
  routeFleet,
  setBoatThrottle,
  setManualControl,
  steerBoat,
  stepFleet,
} from "../simulator/fleet.ts";
import { createDefinition, INITIAL_BOATS, RUDDER_RATE } from "./seed.ts";

// THE FLEET AGGREGATE
//
// One owner for boat state. Every reducer here is a thin wrapper around a pure
// simulator transition; no rule lives in this file. The core still reads no
// clock, no React state and no Redux state, which is the requirement the ledger
// records as "React, Redux, MapLibre, or sockets inside the core -> delete".
//
// The simulator transitions reject bad orders by throwing. A throw out of an
// event handler kills the render, so every call goes through `run`, which puts
// the message in `notice` and leaves the fleet untouched.

export interface FleetSliceState {
  fleet: Fleet;
  /** Highest hull number ever issued per class: a count would re-issue a live ID. */
  hullSequence: Record<BoatType, number>;
  /** Bumped per tasking so two route orders never collide on a mission ID. */
  missionSequence: number;
  notice: string | null;
  safetyAlert: { boatId: BoatId; hazardId: string; hazardLabel: string } | null;
}

function initialFleetState(): FleetSliceState {
  return {
    fleet: createFleet(INITIAL_BOATS),
    hullSequence: { TYPHOON: 2, TEMPEST: 1 },
    missionSequence: 1,
    notice: null,
    safetyAlert: null,
  };
}

function run(
  state: FleetSliceState,
  transition: (fleet: Fleet) => Fleet,
): boolean {
  const snapshot = isDraft(state.fleet) ? current(state.fleet) : state.fleet;

  try {
    state.fleet = transition(snapshot);
    state.notice = null;
    return true;
  } catch (error) {
    state.notice = error instanceof Error ? error.message : "Order rejected";
    return false;
  }
}

export interface AdvanceOrder {
  /** Fixed, never wall-clock: a run must replay to the same result. */
  deltaSeconds: number;
  /** Applied before the fleet steps, so the helm actually turns the boat. */
  rudder: { boatId: BoatId; degrees: number } | null;
  /** Reported external ships, converted to conservative safety circles. */
  traffic?: readonly TrafficHazard[];
}

const fleetSlice = createSlice({
  name: "fleet",
  initialState: initialFleetState,
  reducers: {
    boatAdded: {
      reducer(state, action: PayloadAction<{ type: BoatType; position: Position }>) {
        const { type, position } = action.payload;
        const hullNumber = state.hullSequence[type] + 1;
        const definition = createDefinition(type, hullNumber);

        if (run(state, (fleet) => addBoatToFleet(fleet, { definition, position }))) {
          state.hullSequence[type] = hullNumber;
        }
      },
      prepare(type: BoatType, position: Position) {
        return { payload: { type, position } };
      },
    },

    boatRemoved(state, action: PayloadAction<BoatId>) {
      run(state, (fleet) => removeBoatFromFleet(fleet, action.payload));
    },

    /**
     * One tick: integrate the ordered rudder into a new heading, then step the
     * fleet by the same fixed delta. Both halves are one transition so a tick
     * can never land half-applied.
     */
    fleetAdvanced(state, action: PayloadAction<AdvanceOrder>) {
      const { deltaSeconds, rudder, traffic } = action.payload;
      const before = isDraft(state.fleet) ? current(state.fleet) : state.fleet;
      const previousAlert = state.safetyAlert;

      run(state, (fleet) => {
        const boat = rudder ? fleet.boats[rudder.boatId] : undefined;
        const steered = boat && boat.mode === "MANUAL" && rudder && rudder.degrees !== 0
          ? steerBoat(
              fleet,
              rudder.boatId,
              boat.headingDegrees + rudder.degrees * RUDDER_RATE * deltaSeconds,
            )
          : fleet;

        return stepFleet(steered, deltaSeconds, traffic ?? []);
      });

      const hazards = traffic ?? [];
      const nearHazard = (boatId: BoatId, hazard: TrafficHazard) => {
        const boat = state.fleet.boats[boatId];
        const definition = state.fleet.definitions[boatId];
        if (!boat || !definition) return false;
        const clearance = hullRadiusNm(definition.type)
          + hazard.radiusNm
          + SAFETY_MARGIN_NM
          + (5 / 1852);
        return distanceBetween(boat.position, hazard.position) <= clearance;
      };

      const stillActive = previousAlert
        ? hazards.find((hazard) => (
            hazard.id === previousAlert.hazardId
            && nearHazard(previousAlert.boatId, hazard)
          ))
        : undefined;

      if (stillActive && previousAlert) {
        state.safetyAlert = previousAlert;
        return;
      }

      state.safetyAlert = null;
      for (const [boatId, boat] of Object.entries(state.fleet.boats)) {
        const prior = before.boats[boatId];
        if (!prior || Math.abs(prior.speedKnots) < 1e-9 || Math.abs(boat.speedKnots) > 1e-9) continue;
        const hazard = hazards.find((item) => nearHazard(boatId, item));
        if (!hazard) continue;
        state.safetyAlert = {
          boatId,
          hazardId: hazard.id,
          hazardLabel: hazard.label ?? hazard.id,
        };
        break;
      }
    },


    throttleSet(
      state,
      action: PayloadAction<{ boatId: BoatId; speedKnots: number }>,
    ) {
      const { boatId, speedKnots } = action.payload;
      run(state, (fleet) => setBoatThrottle(fleet, boatId, speedKnots));
    },

    manualSet(state, action: PayloadAction<{ boatId: BoatId; manual: boolean }>) {
      const { boatId, manual } = action.payload;
      run(state, (fleet) => setManualControl(fleet, boatId, manual));
    },

    boatRecalled(state, action: PayloadAction<BoatId>) {
      run(state, (fleet) => recallBoat(fleet, action.payload));
    },

    boatHeld(state, action: PayloadAction<BoatId>) {
      run(state, (fleet) => holdBoat(fleet, action.payload));
    },

    fleetRouted(
      state,
      action: PayloadAction<{
        boatIds: readonly BoatId[];
        pattern: MissionPattern;
        center: Position;
        radiusNm: number;
        cruiseKnots: number;
      }>,
    ) {
      const sequence = state.missionSequence;

      if (run(state, (fleet) => routeFleet(fleet, { ...action.payload, sequence }))) {
        state.missionSequence = sequence + 1;
      }
    },

    /**
     * Task the selection onto a moving contact. Like a route order this bumps
     * the mission sequence only on success, so a rejected follow never burns
     * an ID.
     */
    fleetFollowed(
      state,
      action: PayloadAction<{
        boatIds: readonly BoatId[];
        mode: FollowMode;
        target: Position;
        targetHeadingDegrees: number;
        standoffNm: number;
        cruiseKnots: number;
      }>,
    ) {
      const sequence = state.missionSequence;

      if (run(state, (fleet) => followFleetTarget(fleet, { ...action.payload, sequence }))) {
        state.missionSequence = sequence + 1;
      }
    },

    /**
     * Move the stations of a following group to where their contact is now.
     * This runs on the simulation tick, which is what makes an escort hold
     * station on a ship that is under way rather than on where it once was.
     */
    stationsRetargeted(
      state,
      action: PayloadAction<readonly {
        missionId: string;
        mode: FollowMode;
        target: Position;
        targetHeadingDegrees: number;
        slot: number;
        groupSize: number;
        standoffNm: number;
      }[]>,
    ) {
      if (action.payload.length === 0) return;

      run(state, (fleet) => action.payload.reduce(
        (current, plan) => retargetMission(current, planFollow(plan)),
        fleet,
      ));
    },

    /**
     * Re-plan a perimeter's circuits around its new shape. Dragging the ring is
     * the order; the routes follow from it rather than being re-issued.
     */
    perimeterRetargeted(
      state,
      action: PayloadAction<{
        missionIds: readonly string[];
        center: Position;
        radiusNm: number;
      }>,
    ) {
      const { missionIds, center, radiusNm } = action.payload;
      if (missionIds.length === 0) return;

      run(state, (fleet) => missionIds.reduce((current, missionId, slot) => (
        current.missions[missionId]
          ? retargetMission(current, planMission({
              missionId,
              pattern: "PERIMETER",
              center,
              slot,
              groupSize: missionIds.length,
              radiusNm,
            }))
          : current
      ), fleet));
    },

    noticeCleared(state) {
      state.notice = null;
    },

    fleetReset() {
      return initialFleetState();
    },
  },
});

export const {
  boatAdded,
  boatHeld,
  boatRecalled,
  boatRemoved,
  fleetFollowed,
  fleetAdvanced,
  fleetRouted,
  fleetReset,
  manualSet,
  noticeCleared,
  perimeterRetargeted,
  stationsRetargeted,
  throttleSet,
} = fleetSlice.actions;

export default fleetSlice.reducer;
