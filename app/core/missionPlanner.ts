import type { BoatRole, Mission, MissionId, Position } from "./types";
import {
  advanceAlongHeading,
  bearingBetween,
  distanceBetween,
  moveToward,
} from "./navigation.ts";
import { crossesLand, isNavigable } from "./seaRoom.ts";
import { assertPosition } from "./validation.ts";

/**
 * The orchestration bar tasks a whole group with one click, so a pattern has to
 * turn a single tapped point into one route per boat. Every pattern is pure
 * geometry over the group centre: the same arguments always plan the same
 * waypoints, which is what lets a fleet step be replayed.
 */
export type MissionPattern =
  | "PERIMETER"
  | "SWEEP"
  | "TRANSIT"
  | "ESCORT"
  | "STATION";

export interface MissionPatternSpec {
  pattern: MissionPattern;
  role: BoatRole;
  label: string;
  summary: string;
}

export const MISSION_PATTERNS: readonly MissionPatternSpec[] = [
  {
    pattern: "PERIMETER",
    role: "PATROL",
    label: "Perimeter",
    summary: "Ring the objective, one lane per boat",
  },
  {
    pattern: "SWEEP",
    role: "RECON",
    label: "Sweep",
    summary: "Parallel search lanes across the box",
  },
  {
    pattern: "TRANSIT",
    role: "RESUPPLY",
    label: "Move to",
    summary: "Move to the objective and stop there",
  },
  {
    pattern: "ESCORT",
    role: "PATROL",
    label: "Escort",
    summary: "Line abreast on the objective track",
  },
  {
    pattern: "STATION",
    role: "PATROL",
    label: "Station",
    summary: "Hold an assigned offset and stop",
  },
];

export interface MissionPlanInput {
  missionId: MissionId;
  pattern: MissionPattern;
  center: Position;
  /** Zero-based slot inside the tasked group. */
  slot: number;
  /** How many boats share this tasking. */
  groupSize: number;
  radiusNm: number;
}

function patternSpec(pattern: MissionPattern): MissionPatternSpec {
  const spec = MISSION_PATTERNS.find((entry) => entry.pattern === pattern);

  if (!spec) {
    throw new Error(`Unknown mission pattern: ${pattern}`);
  }

  return spec;
}

/** Step a signed offset along an axis: a negative offset runs the other way. */
function offsetAlong(
  origin: Position,
  headingDegrees: number,
  signedNm: number,
): Position {
  return signedNm < 0
    ? advanceAlongHeading(origin, headingDegrees + 180, -signedNm)
    : advanceAlongHeading(origin, headingDegrees, signedNm);
}

// LAND, AND THE PLAN
//
// The patterns below are pure geometry, and geometry does not know about
// Terminal Island — a ring dropped on a harbour objective used to put half its
// waypoints ashore and run its legs straight across the island. Planning now
// ends by pulling the track into water.
//
// Both corrections pull toward the objective first. That is the whole point of
// the tasking: a boat kept off a mole should end up closer to what it was sent
// to watch, not pushed out to sea away from it.

/** How far from an ideal point to look for water, as a share of the radius. */
const SEARCH_REACH = 0.6;
const SEARCH_RINGS = 10;
const SEARCH_BEARINGS = 12;
/** How many pulls toward the objective to try when a leg is blocked. */
const DETOUR_STEPS = 8;

/**
 * The nearest water to a planned point, searched outward from it and starting
 * on the objective's side, so the correction closes on the objective rather
 * than drifting off it. Null when there is no water within reach, which leaves
 * the caller to drop the point rather than invent one.
 */
function toWater(ideal: Position, center: Position, radiusNm: number): Position | null {
  if (isNavigable(ideal)) return ideal;

  const towardCentre = bearingBetween(ideal, center);

  for (let ring = 1; ring <= SEARCH_RINGS; ring += 1) {
    const reachNm = (radiusNm * SEARCH_REACH * ring) / SEARCH_RINGS;

    for (let turn = 0; turn < SEARCH_BEARINGS; turn += 1) {
      // Alternate either side of the bearing to the objective, so the nearest
      // water on the objective's side wins over water the same distance out.
      const swing = Math.ceil(turn / 2)
        * (360 / SEARCH_BEARINGS)
        * (turn % 2 === 0 ? 1 : -1);
      const probe = advanceAlongHeading(ideal, towardCentre + swing, reachNm);

      if (isNavigable(probe)) return probe;
    }
  }

  return null;
}

/**
 * A single waypoint that gets a blocked leg around whatever is in the way, by
 * pulling the leg's midpoint toward the objective — the inside of a harbour
 * obstruction is where the water usually is, and it keeps the boat close in.
 * Falls back to pulling the other way before giving up.
 */
function detourAround(from: Position, to: Position, center: Position): Position | null {
  const legNm = distanceBetween(from, to);
  if (legNm === 0) return null;

  const mid = moveToward(from, to, legNm / 2);
  const towardCentre = bearingBetween(mid, center);
  const reachNm = Math.max(distanceBetween(mid, center), legNm);

  for (let step = 1; step <= DETOUR_STEPS; step += 1) {
    const pullNm = (reachNm * step) / DETOUR_STEPS;

    for (const bearing of [towardCentre, towardCentre + 180]) {
      const probe = advanceAlongHeading(mid, bearing, pullNm);

      if (
        isNavigable(probe)
        && !crossesLand(from, probe)
        && !crossesLand(probe, to)
      ) {
        return probe;
      }
    }
  }

  return null;
}

/**
 * Turns an ideal track into one a boat can actually run: every waypoint in
 * water, every leg clear of it.
 *
 * Land breaks a track into runs rather than thinning it. A blocked leg that no
 * detour fixes starts a new run at the far side, and the longest run wins; the
 * first attempt here simply dropped the unreachable waypoint and carried the
 * old one forward as the anchor, which made every following leg longer and more
 * likely to be blocked in turn, and a seven-point ring round a harbour collapsed
 * to a single point.
 *
 * `relocate` decides what an ashore waypoint is worth. A station has to exist
 * somewhere, so it is moved to the nearest water. A ring point is not: the ring
 * simply does not go there, and relocating it risks dropping the patrol into an
 * enclosed basin that no later leg can get out of — which collapsed the whole
 * circuit to a dot the first time this was tried.
 *
 * A circuit also has to close. Where the leg home is blocked and no detour
 * exists, the patrol turns around and retraces the arc it just ran instead —
 * every leg back is one it already proved clean, so the boat keeps a continuous
 * patrol of the water the objective actually has, rather than cutting the lap
 * short or sailing through a wharf to finish it.
 *
 * If the whole track is unreachable the ideal is handed back untouched. A
 * mission with no waypoints is not a safer mission, it is a broken one.
 */
function navigableTrack(
  ideal: readonly Position[],
  center: Position,
  radiusNm: number,
  loop: boolean,
  relocate: boolean,
): { waypoints: Position[]; loop: boolean } {
  const snapped: Position[] = [];

  for (const point of ideal) {
    if (isNavigable(point)) {
      snapped.push(point);
      continue;
    }

    if (!relocate) continue;

    const water = toWater(point, center, radiusNm);
    if (water) snapped.push(water);
  }

  if (snapped.length === 0) {
    return { waypoints: ideal.map((point) => ({ ...point })), loop };
  }

  const runs: Position[][] = [[snapped[0]]];

  for (let index = 1; index < snapped.length; index += 1) {
    const run = runs[runs.length - 1];
    const from = run[run.length - 1];
    const to = snapped[index];

    if (!crossesLand(from, to)) {
      run.push(to);
      continue;
    }

    const detour = detourAround(from, to, center);

    if (detour) {
      run.push(detour, to);
      continue;
    }

    // Land in the way with no path round it: the track is cut here, and the
    // far side starts a run of its own.
    runs.push([to]);
  }

  let track = runs[0];
  for (const run of runs) {
    if (run.length > track.length) track = run;
  }

  if (!loop) return { waypoints: track, loop };

  // A lap needs two points to be a lap at all. One surviving waypoint means
  // there was no ring here worth running, so hold station on the objective.
  if (track.length < 2) {
    const station = toWater(center, center, radiusNm);
    return { waypoints: [station ?? { ...center }], loop: false };
  }

  const last = track[track.length - 1];

  // The leg home is clear, or a detour makes it so. Never close by repeating
  // the first waypoint: a zero-length leg stalls the helm.
  if (!crossesLand(last, track[0])) return { waypoints: track, loop: true };

  const detour = detourAround(last, track[0], center);

  if (detour) {
    track.push(detour);
    return { waypoints: track, loop: true };
  }

  // Nothing navigable closes the ring, so the patrol turns around at the end of
  // the arc and runs it back. Every return leg is the reverse of one already
  // walked, which makes the whole circuit clean by construction.
  return {
    waypoints: [...track, ...track.slice(1, -1).reverse()],
    loop: true,
  };
}

function ringWaypoints(
  center: Position,
  radiusNm: number,
  startDegrees: number,
  count: number,
): Position[] {
  const waypoints: Position[] = [];

  for (let step = 0; step < count; step += 1) {
    waypoints.push(
      advanceAlongHeading(center, startDegrees + (360 / count) * step, radiusNm),
    );
  }

  return waypoints;
}

function sweepWaypoints(
  center: Position,
  radiusNm: number,
  slot: number,
  groupSize: number,
): Position[] {
  // Lanes run north and are spaced east across the box, so a group covers the
  // whole width without two boats sharing a lane.
  const laneOffsetNm = radiusNm * ((slot + 0.5) / groupSize - 0.5) * 2;
  const laneCenter = offsetAlong(center, 90, laneOffsetNm);
  const nextLane = advanceAlongHeading(laneCenter, 90, radiusNm / groupSize);

  return [
    advanceAlongHeading(laneCenter, 180, radiusNm),
    advanceAlongHeading(laneCenter, 0, radiusNm),
    advanceAlongHeading(nextLane, 0, radiusNm * 0.2),
    advanceAlongHeading(nextLane, 180, radiusNm),
  ];
}

export function planMission(input: MissionPlanInput): Mission {
  assertPosition(input.center);

  if (!Number.isInteger(input.slot) || input.slot < 0) {
    throw new Error("Mission slot must be a non-negative integer");
  }

  if (!Number.isInteger(input.groupSize) || input.groupSize < 1) {
    throw new Error("Mission group size must be at least one boat");
  }

  if (input.slot >= input.groupSize) {
    throw new Error("Mission slot must be inside the tasked group");
  }

  if (!Number.isFinite(input.radiusNm) || input.radiusNm <= 0) {
    throw new Error("Mission radius must be greater than zero");
  }

  const { center, radiusNm, slot, groupSize } = input;
  const spec = patternSpec(input.pattern);
  const slotDegrees = (360 / groupSize) * slot;
  let waypoints: Position[];

  switch (input.pattern) {
    case "PERIMETER":
      // Twelve points, not four. Four corners on a 1.5 NM ring sag a third of a
      // mile inside the circle, which is both a worse patrol and far more land
      // to cross; twelve hugs the ring closely enough that a leg only meets
      // land where the ring genuinely does.
      waypoints = ringWaypoints(center, radiusNm, slotDegrees, 12);
      break;
    case "SWEEP":
      waypoints = sweepWaypoints(center, radiusNm, slot, groupSize);
      break;
    case "TRANSIT":
      waypoints = [advanceAlongHeading(center, slotDegrees, radiusNm * 0.18)];
      break;
    case "ESCORT": {
      // Line abreast: the group spreads across the track, then runs it together.
      const station = offsetAlong(
        center,
        90,
        radiusNm * ((slot + 0.5) / groupSize - 0.5),
      );

      waypoints = [station, advanceAlongHeading(station, 0, radiusNm * 2)];
      break;
    }
    case "STATION":
      waypoints = [advanceAlongHeading(center, slotDegrees, radiusNm * 0.6)];
      break;
    default:
      throw new Error(`Unknown mission pattern: ${input.pattern}`);
  }

  // A perimeter is a circuit; the rest are routes that finish. A circuit's
  // points are samples of a ring and may be dropped; every other pattern plans
  // stations a boat has to reach, so theirs are moved to water instead.
  const circuit = input.pattern === "PERIMETER";
  const track = navigableTrack(waypoints, center, radiusNm, circuit, !circuit);

  return {
    id: input.missionId,
    role: spec.role,
    waypoints: track.waypoints,
    objective: {
      kind: input.pattern === "PERIMETER"
        ? "PATROL_AREA"
        : input.pattern === "SWEEP"
          ? "SEARCH_AREA"
          : input.pattern === "STATION"
            ? "HOLD_POSITION"
            : "MOVE_TO",
      position: { ...center },
      label: input.pattern === "PERIMETER"
        ? "Patrol the objective perimeter"
        : input.pattern === "SWEEP"
          ? "Search the objective area"
          : input.pattern === "STATION"
            ? "Move to the assigned station and hold"
            : "Move to the assigned objective and stop",
    },
    loop: track.loop,
  };
}

/**
 * THE RUN IN
 *
 * Planning keeps a track off land, but it knows nothing about where the boats
 * are. The leg from a hull's current position to its first waypoint is the one
 * nobody checked, and it is the one most likely to cross a wharf — a vessel
 * alongside in the inner harbour would steam straight through the Port of Los
 * Angeles to reach a ring out in the bay. With the helm now refusing to beach a
 * hull, an unchecked run in does not drive through the land, it stalls against
 * it, so this has to be answered here.
 *
 * A circuit can be joined anywhere, so it is rotated to start at the nearest
 * waypoint the boat can actually see. A route that finishes has an order that
 * matters, so it gets an approach waypoint instead.
 */
export function approachMission(mission: Mission, from: Position): Mission {
  const { waypoints } = mission;
  if (waypoints.length === 0 || !crossesLand(from, waypoints[0])) return mission;

  if (mission.loop) {
    let joinIndex = -1;
    let joinNm = Number.POSITIVE_INFINITY;

    for (let index = 0; index < waypoints.length; index += 1) {
      if (crossesLand(from, waypoints[index])) continue;

      const reachNm = distanceBetween(from, waypoints[index]);
      if (reachNm < joinNm) {
        joinNm = reachNm;
        joinIndex = index;
      }
    }

    if (joinIndex >= 0) {
      return {
        ...mission,
        waypoints: [...waypoints.slice(joinIndex), ...waypoints.slice(0, joinIndex)],
      };
    }
  }

  // Nothing on the track is in sight. Bend the run in around whatever is in the
  // way, pulling toward the objective as every other correction here does.
  const detour = detourAround(
    from,
    waypoints[0],
    mission.objective?.position ?? waypoints[0],
  );

  return detour ? { ...mission, waypoints: [detour, ...waypoints] } : mission;
}
