import type { BoatDefinition, BoatState, Mission, Position } from "./types";
import {
  advanceAlongHeading,
  bearingBetween,
  distanceBetween,
  moveToward,
} from "./navigation.ts";
import { clampToWater, wasBlocked } from "./seaRoom.ts";
import {
  assertBoatDefinition,
  assertMission,
  assertPosition,
} from "./validation.ts";

const ARRIVAL_TOLERANCE_NM = 1e-9;

function assertBoatState(boat: BoatState, definition: BoatDefinition): void {
  if (boat.id !== definition.id) {
    throw new Error("Boat state and definition IDs must match");
  }

  assertPosition(boat.position);

  if (
    !Number.isFinite(boat.headingDegrees) ||
    boat.headingDegrees < 0 ||
    boat.headingDegrees >= 360
  ) {
    throw new Error("Heading must be between 0 and less than 360 degrees");
  }

  if (
    !Number.isFinite(boat.speedKnots) ||
    // Way astern is negative speed on the same heading, so the bound is on
    // magnitude rather than sign.
    Math.abs(boat.speedKnots) > definition.maximumSpeedKnots
  ) {
    throw new Error("Boat speed must be between zero and its maximum speed");
  }

  if (
    !Number.isFinite(boat.energyPercent) ||
    boat.energyPercent < 0 ||
    boat.energyPercent > 100
  ) {
    throw new Error("Energy must be between 0 and 100 percent");
  }

  if (!Number.isInteger(boat.waypointIndex) || boat.waypointIndex < 0) {
    throw new Error("Waypoint index must be a non-negative integer");
  }
}

/**
 * Arrived, and staying. The ordered speed is left alone because it is a throttle
 * demand rather than a log reading: the boat needs it the moment the station
 * moves again.
 */
function holdStation(
  boat: BoatState,
  position: Position,
  headingDegrees: number,
  waypointIndex: number,
): BoatState {
  return {
    ...boat,
    position,
    headingDegrees,
    speedKnots: 0,
    waypointIndex,
  };
}

function completeMission(
  boat: BoatState,
  position: Position,
  headingDegrees: number,
): BoatState {
  return {
    ...boat,
    position,
    headingDegrees,
    speedKnots: 0,
    mode: "HOLD",
    role: null,
    missionId: null,
    waypointIndex: 0,
  };
}

export function stepBoat(
  boat: BoatState,
  definition: BoatDefinition,
  mission: Mission | null,
  deltaSeconds: number,
): BoatState {
  assertBoatDefinition(definition);
  assertBoatState(boat, definition);

  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
    throw new Error("Elapsed time must be a non-negative finite number");
  }

  // Under manual control the operator owns the heading, so the boat runs on its
  // current course instead of consuming waypoints. Its mission is left intact.
  if (boat.mode === "MANUAL") {
    if (deltaSeconds === 0 || boat.speedKnots === 0) {
      return boat;
    }

    // Astern is a negative demand: the boat keeps its heading and walks back
    // down it, rather than turning around. Distance is always positive, so the
    // reversal is carried by the bearing.
    const travelNm = boat.speedKnots * (deltaSeconds / 3600);
    const astern = travelNm < 0;

    const intended = advanceAlongHeading(
      boat.position,
      boat.headingDegrees + (astern ? 180 : 0),
      Math.abs(travelNm),
    );
    const allowed = clampToWater(boat.position, intended);

    return {
      ...boat,
      position: allowed,
      // Driving a hull ashore by hand is still driving it ashore. The helm
      // keeps its heading so the operator can simply steer off again.
      speedKnots: wasBlocked(intended, allowed) ? 0 : boat.speedKnots,
    };
  }

  if (boat.mode !== "MISSION") {
    return boat;
  }

  if (!mission || !boat.missionId || mission.id !== boat.missionId) {
    throw new Error("Mission mode requires the boat's assigned mission");
  }

  assertMission(mission);

  if (boat.role !== mission.role) {
    throw new Error("Boat role must match its assigned mission");
  }

  if (boat.waypointIndex >= mission.waypoints.length) {
    throw new Error("Boat waypoint index is outside its assigned mission");
  }

  if (deltaSeconds === 0 || boat.speedKnots === 0) {
    return boat;
  }

  let position = { ...boat.position };
  let headingDegrees = boat.headingDegrees;
  let waypointIndex = boat.waypointIndex;
  let remainingMovementNm = boat.speedKnots * (deltaSeconds / 3600);
  // A looping circuit of coincident waypoints would otherwise spin here
  // forever, consuming no distance. One pass per waypoint per lap is plenty.
  let guard = mission.waypoints.length * 4 + 8;

  while (remainingMovementNm > 0) {
    if (guard-- <= 0) break;

    const waypoint = mission.waypoints[waypointIndex];
    const distanceToWaypointNm = distanceBetween(position, waypoint);

    if (distanceToWaypointNm <= ARRIVAL_TOLERANCE_NM) {
      waypointIndex += 1;

      if (waypointIndex >= mission.waypoints.length) {
        if (mission.loop) {
          waypointIndex = 0;
          continue;
        }

        return mission.stationKeeping
          ? holdStation(boat, position, headingDegrees, mission.waypoints.length - 1)
          : completeMission(boat, position, headingDegrees);
      }

      continue;
    }

    headingDegrees = bearingBetween(position, waypoint);

    // Land in the way is a reason to give up on this waypoint, not on the
    // mission. The boat runs up to the water's edge and moves on to the next
    // one, which on a circuit is usually round the far side of whatever is in
    // the way. Parking here instead — the first thing tried — left a hull that
    // had been nudged ashore stopped against the beach for good, because a
    // stopped boat never steps again to discover the way is now clear.
    if (remainingMovementNm + ARRIVAL_TOLERANCE_NM < distanceToWaypointNm) {
      const intended = moveToward(position, waypoint, remainingMovementNm);
      const allowed = clampToWater(position, intended);

      if (!wasBlocked(intended, allowed)) {
        position = allowed;
        remainingMovementNm = 0;
        break;
      }

      remainingMovementNm -= distanceBetween(position, allowed);
      position = allowed;
    } else {
      const reached = clampToWater(position, waypoint);

      if (wasBlocked(waypoint, reached)) {
        remainingMovementNm -= distanceBetween(position, reached);
        position = reached;
      } else {
        position = { ...waypoint };
        remainingMovementNm -= distanceToWaypointNm;
      }
    }

    if (remainingMovementNm <= ARRIVAL_TOLERANCE_NM) {
      remainingMovementNm = 0;
    }

    waypointIndex += 1;

    if (waypointIndex >= mission.waypoints.length) {
      if (mission.loop) {
        waypointIndex = 0;
        continue;
      }

      return mission.stationKeeping
        ? holdStation(boat, position, headingDegrees, mission.waypoints.length - 1)
        : completeMission(boat, position, headingDegrees);
    }
  }

  return {
    ...boat,
    position,
    headingDegrees,
    waypointIndex,
  };
}
