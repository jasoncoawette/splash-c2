import { assignMission } from "../core/assignMission.ts";
import { hullRadiusNm } from "../core/hull.ts";
import { clampToWater, wasBlocked } from "../core/seaRoom.ts";
import {
  clampToTraffic,
  separateHulls,
  type TrafficHazard,
} from "../core/separation.ts";
import { createBoatState } from "../core/createBoat.ts";
import {
  approachMission,
  planMission,
  type MissionPattern,
} from "../core/missionPlanner.ts";
import { planFollow, type FollowMode } from "../core/followTarget.ts";
import { distanceBetween } from "../core/navigation.ts";
import { stepBoat } from "../core/stepBoat.ts";
import type {
  BoatDefinition,
  BoatId,
  BoatState,
  Fleet,
  Mission,
  MissionId,
  Position,
} from "../core/types";

export interface BoatSeed {
  definition: BoatDefinition;
  position: Position;
}

function hasOwn(record: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function createFleet(seeds: readonly BoatSeed[]): Fleet {
  const seenBoatIds = new Set<BoatId>();
  const definitionEntries: [BoatId, BoatDefinition][] = [];
  const boatEntries = [];

  for (const seed of seeds) {
    if (seenBoatIds.has(seed.definition.id)) {
      throw new Error(`Duplicate boat ID: ${seed.definition.id}`);
    }

    seenBoatIds.add(seed.definition.id);
    definitionEntries.push([seed.definition.id, seed.definition]);
    boatEntries.push([
      seed.definition.id,
      createBoatState(seed.definition, seed.position),
    ] as const);
  }

  return {
    definitions: Object.fromEntries(definitionEntries),
    boats: Object.fromEntries(boatEntries),
    missions: {},
  };
}

export function addBoatToFleet(fleet: Fleet, seed: BoatSeed): Fleet {
  const boatId = seed.definition.id;

  if (hasOwn(fleet.boats, boatId) || hasOwn(fleet.definitions, boatId)) {
    throw new Error(`Duplicate boat ID: ${boatId}`);
  }

  return {
    ...fleet,
    definitions: {
      ...fleet.definitions,
      [boatId]: seed.definition,
    },
    boats: {
      ...fleet.boats,
      [boatId]: createBoatState(seed.definition, seed.position),
    },
  };
}

/**
 * Remove one boat and anything that only existed for it. A boat's mission has
 * no owner once the boat is gone, so it is dropped with it; missions belonging
 * to other boats are untouched.
 */
export function removeBoatFromFleet(fleet: Fleet, boatId: BoatId): Fleet {
  const boat = fleet.boats[boatId];

  if (!boat || !hasOwn(fleet.boats, boatId)) {
    throw new Error(`Unknown boat ID: ${boatId}`);
  }

  const definitions = { ...fleet.definitions };
  const boats = { ...fleet.boats };
  delete definitions[boatId];
  delete boats[boatId];

  const missions = { ...fleet.missions };
  if (boat.missionId !== null) delete missions[boat.missionId];

  return { definitions, boats, missions };
}

export function assignFleetMission(
  fleet: Fleet,
  boatId: BoatId,
  mission: Mission,
): Fleet {
  const boat = fleet.boats[boatId];

  if (!boat || !hasOwn(fleet.boats, boatId)) {
    throw new Error(`Unknown boat ID: ${boatId}`);
  }

  if (boat.missionId !== null) {
    throw new Error(`Boat already has an active mission: ${boatId}`);
  }

  if (hasOwn(fleet.missions, mission.id)) {
    throw new Error(`Duplicate mission ID: ${mission.id}`);
  }

  return {
    ...fleet,
    boats: {
      ...fleet.boats,
      [boatId]: assignMission(boat, mission),
    },
    missions: {
      ...fleet.missions,
      [mission.id]: mission,
    },
  };
}

export function stepFleet(
  fleet: Fleet,
  deltaSeconds: number,
  traffic: readonly TrafficHazard[] = [],
): Fleet {
  const nextBoatEntries = Object.entries(fleet.boats).map(([boatId, boat]) => {
    const definition = fleet.definitions[boatId];

    if (!definition || !hasOwn(fleet.definitions, boatId)) {
      throw new Error(`Missing definition for boat: ${boatId}`);
    }

    let mission: Mission | null = null;

    if (boat.missionId !== null) {
      const assignedMission = fleet.missions[boat.missionId as MissionId];

      if (!assignedMission || !hasOwn(fleet.missions, boat.missionId)) {
        throw new Error(`Missing mission for boat: ${boatId}`);
      }

      mission = assignedMission;
    }

    return [boatId, stepBoat(boat, definition, mission, deltaSeconds)] as const;
  });

  return holdClear(fleet, Object.fromEntries(nextBoatEntries), traffic);
}

/**
 * The world the fleet moves through: land it cannot cross and hulls it cannot
 * share. Applied after every boat has stepped, because neither rule belongs to
 * a single boat — `stepBoat` can see one hull and no shoreline.
 *
 * A boat whose track is cut short by land stops there rather than grinding
 * along it, which is what an autonomous hull would do on losing sea room.
 */
function holdClear(
  before: Fleet,
  stepped: Record<BoatId, BoatState>,
  traffic: readonly TrafficHazard[],
): Fleet {
  const ashoreHeld: Record<BoatId, BoatState> = {};

  for (const [boatId, boat] of Object.entries(stepped)) {
    const previous = before.boats[boatId];
    const waterAllowed = previous
      ? clampToWater(previous.position, boat.position)
      : boat.position;
    const allowed = previous
      ? clampToTraffic(
          previous.position,
          waterAllowed,
          hullRadiusNm(before.definitions[boat.id].type),
          traffic,
        )
      : waterAllowed;

    const trafficBlocked = wasBlocked(waterAllowed, allowed);
    ashoreHeld[boatId] = wasBlocked(boat.position, allowed)
      ? {
          ...boat,
          position: allowed,
          speedKnots: 0,
          mode: trafficBlocked && boat.mode !== "MANUAL" ? "HOLD" : boat.mode,
        }
      : boat;
  }

  const separated = separateHulls(
    Object.values(ashoreHeld).map((boat) => ({
      id: boat.id,
      position: boat.position,
      radiusNm: hullRadiusNm(before.definitions[boat.id].type),
    })),
  );

  const boats: Record<BoatId, BoatState> = {};

  for (const [boatId, boat] of Object.entries(ashoreHeld)) {
    const separatedPosition = separated.get(boatId);
    const position = separatedPosition
      ? clampToTraffic(
          boat.position,
          separatedPosition,
          hullRadiusNm(before.definitions[boat.id].type),
          traffic,
        )
      : undefined;
    boats[boatId] = position && wasBlocked(boat.position, position)
      ? { ...boat, position }
      : boat;
  }

  return { ...before, boats };
}

function requireBoat(fleet: Fleet, boatId: BoatId): BoatState {
  const boat = fleet.boats[boatId];

  if (!boat || !hasOwn(fleet.boats, boatId)) {
    throw new Error(`Unknown boat ID: ${boatId}`);
  }

  return boat;
}

function withBoat(fleet: Fleet, boat: BoatState): Fleet {
  return {
    ...fleet,
    boats: {
      ...fleet.boats,
      [boat.id]: boat,
    },
  };
}

/** Throttle demand from the helm, held inside the platform's rated speed. */
export function setBoatThrottle(
  fleet: Fleet,
  boatId: BoatId,
  speedKnots: number,
): Fleet {
  const boat = requireBoat(fleet, boatId);
  const definition = fleet.definitions[boatId];

  // Astern is a negative demand, not an invalid one; only a demand that is not
  // a number is impossible. The rating still bounds the magnitude, and it holds
  // rather than rejects, because `routeFleet` passes a cruise speed that may be
  // faster than the hull and expects it pinned to the hull's own limit.
  if (!Number.isFinite(speedKnots)) {
    throw new Error("Throttle must be a finite number");
  }

  const rated = definition.maximumSpeedKnots;

  return withBoat(fleet, {
    ...boat,
    speedKnots: Math.max(Math.min(speedKnots, rated), -rated),
  });
}

/** Rudder demand from the helm, normalised onto the compass. */
export function steerBoat(
  fleet: Fleet,
  boatId: BoatId,
  headingDegrees: number,
): Fleet {
  const boat = requireBoat(fleet, boatId);

  if (!Number.isFinite(headingDegrees)) {
    throw new Error("Heading must be a finite number");
  }

  return withBoat(fleet, {
    ...boat,
    headingDegrees: ((headingDegrees % 360) + 360) % 360,
  });
}

/**
 * Take the helm, or hand it back. Taking over keeps the mission so the
 * autopilot can resume the same route; handing back returns the boat to that
 * route, or to idle when it was never tasked.
 */
export function setManualControl(
  fleet: Fleet,
  boatId: BoatId,
  manual: boolean,
): Fleet {
  const boat = requireBoat(fleet, boatId);

  if (manual) {
    return boat.mode === "MANUAL" ? fleet : withBoat(fleet, { ...boat, mode: "MANUAL" });
  }

  if (boat.mode !== "MANUAL") {
    return fleet;
  }

  return withBoat(fleet, {
    ...boat,
    mode: boat.missionId === null ? "IDLE" : "MISSION",
  });
}

/**
 * Stop one boat without discarding its mission. This is the deterministic
 * onboard failsafe used when the command link is lost: the hull stops, while
 * the assignment remains available for recovery or later operator review.
 */
export function holdBoat(fleet: Fleet, boatId: BoatId): Fleet {
  const boat = requireBoat(fleet, boatId);

  return withBoat(fleet, {
    ...boat,
    speedKnots: 0,
    mode: "HOLD",
  });
}

/** Drop a tasking so the boat can be re-tasked, and stop it where it stands. */
export function recallBoat(fleet: Fleet, boatId: BoatId): Fleet {
  const boat = requireBoat(fleet, boatId);

  if (boat.missionId === null && boat.mode === "IDLE") {
    return fleet;
  }

  const remainingMissions = { ...fleet.missions };

  if (boat.missionId !== null) {
    delete remainingMissions[boat.missionId];
  }

  return {
    ...fleet,
    boats: {
      ...fleet.boats,
      [boatId]: {
        ...boat,
        speedKnots: 0,
        mode: "IDLE",
        role: null,
        missionId: null,
        waypointIndex: 0,
      },
    },
    missions: remainingMissions,
  };
}

/**
 * A group order names one cruise speed, but a mixed group does not share one
 * rating. Each boat runs at the best speed it can rather than the whole order
 * failing because the slowest hull cannot make the number.
 */
function cruiseFor(fleet: Fleet, boatId: BoatId, cruiseKnots: number): number {
  const rated = fleet.definitions[boatId]?.maximumSpeedKnots ?? cruiseKnots;

  return Math.min(Math.abs(cruiseKnots), rated);
}

export interface FleetRouteOrder {
  boatIds: readonly BoatId[];
  pattern: MissionPattern;
  center: Position;
  radiusNm: number;
  cruiseKnots: number;
  /** Bumped by the caller so repeated taskings never reuse a mission ID. */
  sequence: number;
}

/**
 * Task a whole group in one transition. Each boat is recalled, given its slot's
 * plan and a cruise throttle, so a second tap on a pattern re-routes the group
 * rather than failing on the boats that are already running.
 */
export function routeFleet(fleet: Fleet, order: FleetRouteOrder): Fleet {
  if (order.boatIds.length === 0) {
    throw new Error("A route order requires at least one boat");
  }

  const seen = new Set<BoatId>();

  return order.boatIds.reduce((currentFleet, boatId, slot) => {
    if (seen.has(boatId)) {
      throw new Error(`Duplicate boat ID in route order: ${boatId}`);
    }

    seen.add(boatId);
    const recalled = recallBoat(currentFleet, boatId);
    // The run in is planned from where the hull actually is, so a boat
    // alongside does not set off through a wharf to reach its first waypoint.
    const mission = approachMission(
      planMission({
        missionId: `${order.pattern.toLowerCase()}-${order.sequence}-${slot}`,
        pattern: order.pattern,
        center: order.center,
        slot,
        groupSize: order.boatIds.length,
        radiusNm: order.radiusNm,
      }),
      recalled.boats[boatId].position,
    );
    const cruiseKnots = cruiseFor(currentFleet, boatId, order.cruiseKnots);
    const orderedMission = { ...mission, cruiseKnots };

    return assignFleetMission(
      setBoatThrottle(recalled, boatId, cruiseKnots),
      boatId,
      orderedMission,
    );
  }, fleet);
}

/**
 * Replace a live mission's waypoints without re-issuing it. Following a moving
 * contact means re-planning every tick, and recalling then re-assigning would
 * churn the mission ID and drop the boat to IDLE for a frame. The role is held
 * constant because `stepBoat` requires the boat's role to match its mission.
 */
export function retargetMission(fleet: Fleet, mission: Mission): Fleet {
  const current = fleet.missions[mission.id];

  if (!current || !hasOwn(fleet.missions, mission.id)) {
    throw new Error(`Unknown mission ID: ${mission.id}`);
  }

  if (current.role !== mission.role) {
    throw new Error(`Retargeting must not change a mission's role: ${mission.id}`);
  }

  const nextMission = {
    ...mission,
    cruiseKnots: mission.cruiseKnots ?? current.cruiseKnots,
  };
  const previousStation = current.waypoints[current.waypoints.length - 1];
  const nextStation = nextMission.waypoints[0];
  const stationMoved = previousStation && nextStation
    ? distanceBetween(previousStation, nextStation) > 1e-6
    : true;
  const boatEntries = Object.entries(fleet.boats).map(([boatId, boat]) => {
    if (boat.missionId !== mission.id) return [boatId, boat] as const;

    return [boatId, {
      ...boat,
      waypointIndex: 0,
      speedKnots: stationMoved && boat.speedKnots === 0
        ? nextMission.cruiseKnots ?? 0
        : boat.speedKnots,
    }] as const;
  });

  return {
    ...fleet,
    boats: Object.fromEntries(boatEntries),
    missions: {
      ...fleet.missions,
      [mission.id]: nextMission,
    },
  };
}

export interface FleetFollowOrder {
  boatIds: readonly BoatId[];
  mode: FollowMode;
  target: Position;
  targetHeadingDegrees: number;
  standoffNm: number;
  cruiseKnots: number;
  sequence: number;
}

/** Task a group onto a moving contact. One mission per boat, one station each. */
export function followFleetTarget(fleet: Fleet, order: FleetFollowOrder): Fleet {
  if (order.boatIds.length === 0) {
    throw new Error("A follow order requires at least one boat");
  }

  const seen = new Set<BoatId>();

  return order.boatIds.reduce((currentFleet, boatId, slot) => {
    if (seen.has(boatId)) {
      throw new Error(`Duplicate boat ID in follow order: ${boatId}`);
    }

    seen.add(boatId);
    const mission = planFollow({
      missionId: `${order.mode.toLowerCase()}-${order.sequence}-${slot}`,
      mode: order.mode,
      target: order.target,
      targetHeadingDegrees: order.targetHeadingDegrees,
      slot,
      groupSize: order.boatIds.length,
      standoffNm: order.standoffNm,
    });
    const cruiseKnots = cruiseFor(currentFleet, boatId, order.cruiseKnots);
    const orderedMission = { ...mission, cruiseKnots };

    return assignFleetMission(
      setBoatThrottle(
        recallBoat(currentFleet, boatId),
        boatId,
        cruiseKnots,
      ),
      boatId,
      orderedMission,
    );
  }, fleet);
}
