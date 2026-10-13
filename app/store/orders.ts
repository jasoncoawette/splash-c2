import type { MissionPattern } from "../core/missionPlanner.ts";
import type { BoatId, BoatType } from "../core/types";
import type { FollowMode } from "../core/followTarget.ts";
import type { Position } from "../core/types";
import type { TrafficHazard } from "../core/separation.ts";
import {
  boatAdded,
  boatHeld,
  boatRecalled,
  boatRemoved,
  fleetAdvanced,
  fleetFollowed,
  fleetRouted,
  manualSet,
  perimeterRetargeted,
  stationsRetargeted,
  throttleSet,
  fleetReset,
} from "./fleetSlice.ts";
import {
  perimeterAdded,
  perimeterMissionsSet,
  perimeterShaped,
} from "./perimeterSlice.ts";
import {
  followsAssigned,
  followsDropped,
  type FollowAssignment,
} from "./trafficSlice.ts";
import {
  boatForgotten,
  boatSelected,
  objectiveMoved,
  radiusChanged,
  cameraSelected,
  orbitMoved,
  boatsSelected,
  commandReset,
  detailPanelToggled,
  fleetPanelToggled,
  rudderCentred,
  rudderOrdered,
  rudderStepped,
  throttleNotchSet,
  throttleStepped,
  viewChanged,
  THROTTLE_NOTCHES,
} from "./commandSlice.ts";
import { selectBoatStates, selectSelectedBoatId } from "./selectors.ts";
import { CREATION_POSITIONS, TICK_SECONDS } from "./seed.ts";
import { boundsOf, cellOfKey } from "../core/surveyGrid.ts";
import { telemetryCleared, telemetrySampled } from "./telemetrySlice.ts";
import {
  scenarioAlertAcknowledged,
  scenarioClosed,
  scenarioLinkLost,
  scenarioMissionLaunched,
  scenarioOpened,
  scenarioPrepared,
  scenarioReset,
  scenarioResolved,
  scenarioToggled,
} from "./scenarioSlice.ts";
import type { AppDispatch, RootState } from "./index.ts";

// ORDERS
//
// The few operations that touch more than one slice. Everything else is a plain
// action. Each of these is what an operator actually does, so the container
// calls one function per button rather than sequencing dispatches itself.

type Thunk = (dispatch: AppDispatch, getState: () => RootState) => void;

export const DEMO_BOAT_IDS = ["typhoon-01", "typhoon-02", "tempest-01"] as const;
export const DEMO_OBJECTIVE: Position = { latitude: 33.712, longitude: -118.229 };

/**
 * Put the guided workflow on the screen, or take it off. Neither direction
 * touches the fleet: the demo is a coach over the live console, so closing it
 * leaves the vessels exactly where the operator left them, and re-opening it
 * resumes at the step that was reached.
 */
export function toggleDemoScenario(open?: boolean): Thunk {
  return (dispatch) => {
    dispatch(scenarioToggled(open));
  };
}

export function openDemoScenario(): Thunk {
  return (dispatch) => {
    dispatch(scenarioOpened());
  };
}

export function closeDemoScenario(): Thunk {
  return (dispatch) => {
    dispatch(scenarioClosed());
  };
}

/** Load the known three-hull team and frame the patrol objective. */
export function prepareDemoScenario(): Thunk {
  return (dispatch) => {
    dispatch(fleetReset());
    dispatch(commandReset());
    dispatch(telemetryCleared());
    dispatch(scenarioReset());
    dispatch(scenarioOpened());
    dispatch(boatsSelected(DEMO_BOAT_IDS));
    dispatch(objectiveMoved(DEMO_OBJECTIVE));
    dispatch(radiusChanged(1.5));
    dispatch(fleetPanelToggled(true));
    dispatch(detailPanelToggled(true));
    dispatch(viewChanged("FLEET"));
    dispatch(scenarioPrepared(DEMO_BOAT_IDS));
  };
}

/** Issue the real perimeter order; the simulation clock moves it from here. */
export function launchDemoScenario(): Thunk {
  return (dispatch, getState) => {
    if (getState().scenario.phase !== "READY") return;
    const before = getState().fleet.missionSequence;

    dispatch(fleetRouted({
      boatIds: DEMO_BOAT_IDS,
      pattern: "PERIMETER",
      center: DEMO_OBJECTIVE,
      radiusNm: 1.5,
      cruiseKnots: 22,
    }));

    if (getState().fleet.missionSequence !== before) {
      dispatch(scenarioMissionLaunched());
    }
  };
}

/** Drop TY-02's command link and let its onboard safety rule hold position. */
export function injectDemoLinkLoss(): Thunk {
  return (dispatch, getState) => {
    if (getState().scenario.phase !== "ACTIVE") return;
    const affected = getState().scenario.affectedBoatId;
    dispatch(boatHeld(affected));
    if (getState().fleet.notice) return;

    dispatch(scenarioLinkLost());
    dispatch(boatsSelected([affected]));
    dispatch(detailPanelToggled(true));
  };
}

export function acknowledgeDemoAlert(): Thunk {
  return (dispatch, getState) => {
    if (getState().scenario.phase === "LINK_LOST") {
      dispatch(scenarioAlertAcknowledged());
    }
  };
}

/** Leave the isolated hull in its safety hold and re-task the two healthy boats. */
export function resolveDemoScenario(): Thunk {
  return (dispatch, getState) => {
    if (getState().scenario.phase !== "ACKNOWLEDGED") return;
    const affected = getState().scenario.affectedBoatId;
    const online = DEMO_BOAT_IDS.filter((boatId) => boatId !== affected);
    const before = getState().fleet.missionSequence;

    dispatch(boatsSelected(online));
    online.forEach((boatId) => dispatch(boatRecalled(boatId)));
    dispatch(fleetRouted({
      boatIds: online,
      pattern: "PERIMETER",
      center: DEMO_OBJECTIVE,
      radiusNm: 1.5,
      cruiseKnots: 22,
    }));

    if (getState().fleet.missionSequence !== before) {
      dispatch(scenarioResolved());
    }
  };
}

export function resetDemoScenario(): Thunk {
  return (dispatch) => {
    dispatch(fleetReset());
    dispatch(commandReset());
    dispatch(telemetryCleared());
    dispatch(scenarioReset());
  };
}

/** Create a boat of a class at the next free anchorage and task the operator to it. */
export function createBoat(type: BoatType): Thunk {
  return (dispatch, getState) => {
    const count = selectBoatStates(getState()).length;
    const position = CREATION_POSITIONS[count % CREATION_POSITIONS.length];

    dispatch(boatAdded(type, position));

    const added = selectBoatStates(getState());
    if (added.length === count) return;

    const created = added[added.length - 1];
    dispatch(boatSelected(created.id));
    dispatch(boatsSelected([...getState().command.selectedIds, created.id]));
  };
}

/** Remove a boat, and let the selection and every group forget it. */
export function removeBoat(boatId: BoatId): Thunk {
  return (dispatch, getState) => {
    const remaining = selectBoatStates(getState()).filter((boat) => boat.id !== boatId);

    dispatch(boatRemoved(boatId));
    dispatch(boatForgotten({ boatId, nextSelectedId: remaining[0]?.id ?? "" }));
  };
}

/** Task the current selection with a pattern around the current objective. */
export function routeSelection(pattern: MissionPattern): Thunk {
  return (dispatch, getState) => {
    const { selectedIds, objective, radiusNm, cruiseKnots } = getState().command;
    if (selectedIds.length === 0 || !objective) return;

    dispatch(fleetRouted({
      boatIds: selectedIds,
      pattern,
      center: objective,
      radiusNm,
      cruiseKnots,
    }));
  };
}

/**
 * Raise a perimeter around the objective and put the selection on it. The ring
 * owns the tasking from here: moving or resizing it re-plans the same missions
 * rather than issuing new ones.
 */
export function raisePerimeter(): Thunk {
  return (dispatch, getState) => {
    const state = getState();
    const { selectedIds, objective, radiusNm, cruiseKnots } = state.command;
    if (selectedIds.length === 0 || !objective) return;

    const sequence = state.fleet.missionSequence;

    dispatch(fleetRouted({
      boatIds: selectedIds,
      pattern: "PERIMETER",
      center: objective,
      radiusNm,
      cruiseKnots,
    }));

    if (getState().fleet.missionSequence === sequence) return;

    const id = `perimeter-${state.perimeters.sequence}`;

    dispatch(perimeterAdded({
      id,
      name: `Perimeter ${state.perimeters.sequence}`,
      center: objective,
      radiusNm,
      boatIds: selectedIds,
    }));
    dispatch(perimeterMissionsSet({
      id,
      missionIds: selectedIds.map((_, slot) => `perimeter-${sequence}-${slot}`),
    }));
  };
}

/** One drag of a ring: reshape it, then re-plan whatever is flying it. */
export function reshapePerimeter(
  id: string,
  shape: { center?: { latitude: number; longitude: number }; radiusNm?: number },
): Thunk {
  return (dispatch, getState) => {
    dispatch(perimeterShaped({ id, ...shape }));

    const perimeter = getState().perimeters.perimeters.find((item) => item.id === id);
    if (!perimeter || perimeter.missionIds.length === 0) return;

    dispatch(perimeterRetargeted({
      missionIds: perimeter.missionIds,
      center: perimeter.center,
      radiusNm: perimeter.radiusNm,
    }));
  };
}

/** Where a follow target is right now, or null if it has stopped reporting. */
function resolveTarget(
  state: RootState,
  follow: Pick<FollowAssignment, "targetMmsi" | "targetBoatId">,
): { position: Position; headingDegrees: number } | null {
  if (follow.targetMmsi !== null) {
    const contact = state.traffic.contacts.find((item) => item.mmsi === follow.targetMmsi);

    return contact
      ? {
          position: { latitude: contact.latitude, longitude: contact.longitude },
          headingDegrees: contact.headingDegrees,
        }
      : null;
  }

  if (follow.targetBoatId !== null) {
    const boat = state.fleet.fleet.boats[follow.targetBoatId];

    return boat
      ? { position: boat.position, headingDegrees: boat.headingDegrees }
      : null;
  }

  return null;
}

/**
 * Screen a contact with the current selection. The target can be live traffic
 * or one of our own boats; both resolve to a position and a course, which is
 * all a station needs.
 */
export function followSelection(mode: FollowMode): Thunk {
  return (dispatch, getState) => {
    const state = getState();
    const { selectedIds, cruiseKnots } = state.command;
    const { targetMmsi, targetBoatId, standoffNm } = state.traffic;

    if (selectedIds.length === 0) return;

    const screening = selectedIds.filter((boatId) => boatId !== targetBoatId);
    if (screening.length === 0) return;

    const target = resolveTarget(state, { targetMmsi, targetBoatId });
    if (!target) return;

    const sequence = state.fleet.missionSequence;

    dispatch(fleetFollowed({
      boatIds: screening,
      mode,
      target: target.position,
      targetHeadingDegrees: target.headingDegrees,
      standoffNm,
      cruiseKnots,
    }));

    // Only record the screen if the order was actually accepted.
    if (getState().fleet.missionSequence === sequence) return;

    dispatch(followsAssigned(screening.map((boatId, slot): FollowAssignment => ({
      missionId: `${mode.toLowerCase()}-${sequence}-${slot}`,
      mode,
      targetMmsi,
      targetBoatId,
      slot,
      groupSize: screening.length,
      standoffNm,
    }))));
  };
}

/**
 * Take the helm of a boat: select it, centre the rudder, open the front view,
 * and set the telegraph to where the boat already is so the first key press
 * moves it by one notch rather than jumping it to a stored position.
 */
export function takeOver(boatId: BoatId): Thunk {
  return (dispatch, getState) => {
    dispatch(boatSelected(boatId));
    dispatch(rudderOrdered(0));
    dispatch(viewChanged("HELM"));

    const { boats, definitions } = getState().fleet.fleet;
    const boat = boats[boatId];
    const definition = definitions[boatId];
    if (!boat || !definition) return;

    dispatch(throttleNotchSet(nearestNotch(boat.speedKnots, definition.maximumSpeedKnots)));
  };
}

/** The telegraph position closest to a speed the boat is already making. */
function nearestNotch(speedKnots: number, maximumSpeedKnots: number): number {
  if (maximumSpeedKnots <= 0) return 0;
  const fraction = speedKnots / maximumSpeedKnots;

  return THROTTLE_NOTCHES.reduce((best, notch, index) => (
    Math.abs(notch - fraction) < Math.abs(THROTTLE_NOTCHES[best] - fraction) ? index : best
  ), 0);
}

/**
 * A hand on the helm. The keyboard controls only mean anything under manual
 * control, so the first press takes the helm rather than being swallowed.
 */
function withHelm(
  getState: () => RootState,
): { boatId: BoatId; maximumSpeedKnots: number } | null {
  const { selectedBoatId } = getState().command;
  const { boats, definitions } = getState().fleet.fleet;
  const boat = boats[selectedBoatId];
  const definition = definitions[selectedBoatId];
  if (!boat || !definition) return null;
  if (boat.mode !== "MANUAL") return null;

  return { boatId: selectedBoatId, maximumSpeedKnots: definition.maximumSpeedKnots };
}

/** One notch up or down the engine telegraph, then order the speed it means. */
export function stepThrottle(delta: number): Thunk {
  return (dispatch, getState) => {
    const helm = withHelm(getState);
    if (!helm) return;

    dispatch(throttleStepped(delta));
    const notch = THROTTLE_NOTCHES[getState().command.throttleNotch];
    dispatch(throttleSet({
      boatId: helm.boatId,
      speedKnots: notch * helm.maximumSpeedKnots,
    }));
  };
}

/** Swing the rudder a step to port (-1) or starboard (+1). */
export function stepRudder(delta: number): Thunk {
  return (dispatch, getState) => {
    if (!withHelm(getState)) return;
    dispatch(rudderStepped(delta));
  };
}

export function centreRudder(): Thunk {
  return (dispatch) => {
    dispatch(rudderCentred());
  };
}

/**
 * Swing the external camera. Only that station reads the orbit, so reaching for
 * it from a fixed camera moves to the chase view rather than doing nothing.
 */
export function nudgeOrbit(
  delta: { yaw?: number; pitch?: number; distance?: number },
): Thunk {
  return (dispatch, getState) => {
    if (getState().command.helmCamera !== "EXTERNAL") {
      dispatch(cameraSelected("EXTERNAL"));
    }

    const orbit = getState().command.orbit;
    dispatch(orbitMoved({
      yawDegrees: orbit.yawDegrees + (delta.yaw ?? 0),
      pitchDegrees: orbit.pitchDegrees + (delta.pitch ?? 0),
      distanceM: orbit.distanceM * (1 + (delta.distance ?? 0)),
    }));
  };
}

export function toggleManual(manual: boolean): Thunk {
  return (dispatch, getState) => {
    dispatch(manualSet({ boatId: selectSelectedBoatId(getState()), manual }));
    dispatch(rudderOrdered(0));
  };
}

export function setThrottle(speedKnots: number): Thunk {
  return (dispatch, getState) => {
    dispatch(throttleSet({ boatId: selectSelectedBoatId(getState()), speedKnots }));
  };
}

/**
 * One simulation tick. The delta is TICK_SECONDS times the sim rate and never
 * wall-clock time, so a run replays to the same result. Telemetry is sampled
 * from the fleet the tick produced, never from the fleet before it.
 */
export function simulationTicked(): Thunk {
  return (dispatch, getState) => {
    const state = getState();
    const { simRate, rudderDegrees, selectedBoatId } = state.command;
    const deltaSeconds = TICK_SECONDS * simRate;
    const traffic: TrafficHazard[] = state.traffic.contacts.map((contact) => {
      // AIS is a report, not a live physical sensor. Grow the ship's circle by
      // the distance it could travel before the next 15-second refresh, plus
      // the report age (capped so one stale tile cannot close the whole port).
      const uncertaintySeconds = Math.min(Math.max(contact.ageSeconds, 0) + 15, 120);
      const uncertaintyNm = Math.max(contact.speedKnots, 0) * uncertaintySeconds / 3600;

      return {
        id: `mmsi-${contact.mmsi}`,
        label: contact.name || `MMSI ${contact.mmsi}`,
        position: { latitude: contact.latitude, longitude: contact.longitude },
        radiusNm: Math.max(contact.lengthM ?? 30, 5) / 2 / 1852 + uncertaintyNm,
      };
    });

    dispatch(fleetAdvanced({
      deltaSeconds,
      rudder: rudderDegrees === 0 ? null : { boatId: selectedBoatId, degrees: rudderDegrees },
      traffic,
    }));

    dispatch(telemetrySampled({ deltaSeconds, boats: selectBoatStates(getState()) }));

    // Move every live screen onto where its contact is now. A screen whose
    // mission has ended, or whose contact has stopped reporting, is dropped
    // rather than left pointing at a stale position.
    const after = getState();
    const stale: string[] = [];
    const plans = [];

    for (const follow of after.traffic.follows) {
      if (!after.fleet.fleet.missions[follow.missionId]) {
        stale.push(follow.missionId);
        continue;
      }

      const target = resolveTarget(after, follow);

      if (!target) {
        stale.push(follow.missionId);
        continue;
      }

      plans.push({
        missionId: follow.missionId,
        mode: follow.mode,
        target: target.position,
        targetHeadingDegrees: target.headingDegrees,
        slot: follow.slot,
        groupSize: follow.groupSize,
        standoffNm: follow.standoffNm,
      });
    }

    if (stale.length > 0) dispatch(followsDropped(stale));
    if (plans.length > 0) dispatch(stationsRetargeted(plans));
  };
}


/**
 * Search the marked squares.
 *
 * The squares say WHERE; the sweep pattern says HOW. So this sets the objective
 * to the middle of them and opens the radius far enough to cover the furthest
 * corner, then issues the sweep the fleet already knows how to fly. A square is
 * a search area, not a waypoint, which is why it does not become one.
 */
export function exploreSurvey(): Thunk {
  return (dispatch, getState) => {
    const { cells, cellSizeNm } = getState().survey;
    if (cells.length === 0) return;
    if (getState().command.selectedIds.length === 0) return;

    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;

    for (const key of cells) {
      const box = boundsOf(cellOfKey(key), cellSizeNm);
      west = Math.min(west, box.west);
      east = Math.max(east, box.east);
      south = Math.min(south, box.south);
      north = Math.max(north, box.north);
    }

    const centre = { latitude: (south + north) / 2, longitude: (west + east) / 2 };
    const halfHeightNm = ((north - south) / 2) * 60;
    const halfWidthNm = ((east - west) / 2) * 60
      * Math.cos((centre.latitude * Math.PI) / 180);
    const radiusNm = Math.max(Math.hypot(halfWidthNm, halfHeightNm), cellSizeNm / 2);

    dispatch(objectiveMoved(centre));
    dispatch(radiusChanged(Number(radiusNm.toFixed(2))));
    dispatch(routeSelection("SWEEP"));
  };
}
