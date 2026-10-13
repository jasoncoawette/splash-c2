import type { Fleet, Mission, Position } from "../core/types";
import { bearingBetween, distanceBetween } from "../core/navigation.ts";

// WHAT IS IN PROGRESS
//
// The fleet panel says what the operator owns. This says what it is doing: one
// line per hull, naming the work, where it is going, and how far through it is.
//
// Derived, never authoritative. Everything below is computed from the fleet
// aggregate plus the link and escort records the store already holds; nothing
// here writes, and nothing holds state of its own.
//
// Pure, and outside the core on purpose: it reads link state and escort
// assignments, which are store concerns, so putting it in `app/core` would
// have made the core import adapter shapes. It takes them as plain values
// instead, so it is still testable in plain Node.

/** What kind of work a hull is doing, which is also how its row is coloured. */
export type ActivityKind = "MOVING" | "HOLDING" | "MANUAL" | "IDLE" | "FAULT";

export interface ActivityEntry {
  boatId: string;
  name: string;
  /** The work, named: "Patrolling", "Escorting MAERSK ESSEX", "Link lost". */
  headline: string;
  /** Where it is going: a bearing and a range, or the station it is holding. */
  where: string;
  /** How long until it gets there, or why that question has no answer. */
  eta: string;
  /**
   * Legs flown over legs ordered, 0..1, with part credit for the leg under
   * way. Null when there is no route to be partway along: a progress bar on an
   * idle hull would be reporting on nothing.
   */
  progress: number | null;
  /** Speed as a fraction of what the platform is rated for. */
  effort: number;
  speedKnots: number;
  kind: ActivityKind;
}

export interface ActivitySummary {
  entries: ActivityEntry[];
  /** Hulls actually making way. */
  underway: number;
  total: number;
  /** Hulls carrying a mission, whether or not they are moving. */
  tasked: number;
  /**
   * The fleet's activity measure: mean speed over mean rated speed. One number
   * for "how much boat is in motion", which is the question a glance asks.
   */
  effort: number;
  /** Hulls in a fault state, which is what the measure must not average away. */
  faults: number;
}

/** What a follow order is pointed at, structurally matched from the traffic slice. */
export interface FollowRecord {
  missionId: string;
  mode: "ESCORT" | "MONITOR";
  targetMmsi: number | null;
  targetBoatId: string | null;
}

export interface ActivityInputs {
  /** Boat id to link state; anything other than "LOST" is treated as up. */
  links?: Record<string, string>;
  follows?: readonly FollowRecord[];
  /** Live contacts, so an escort can be named rather than numbered. */
  contacts?: readonly { mmsi: number; name: string }[];
}

/** Below this a hull is stopped, not creeping. */
const MOVING_KNOTS = 0.2;

const OBJECTIVE_WORK: Record<string, string> = {
  MOVE_TO: "Transiting",
  PATROL_AREA: "Patrolling",
  SEARCH_AREA: "Searching",
  HOLD_POSITION: "Holding position",
  ESCORT_TARGET: "Escorting",
  MONITOR_TARGET: "Monitoring",
};

const ROLE_WORK: Record<string, string> = {
  PATROL: "On patrol",
  RECON: "On recon",
  RESUPPLY: "On resupply",
};

function compass(degrees: number): string {
  return `${Math.round(((degrees % 360) + 360) % 360).toString().padStart(3, "0")}°`;
}

/** Minutes, said the way a person would say them. */
function formatEta(hours: number): string {
  const minutes = hours * 60;
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`;
}

/**
 * How far through its route a hull is.
 *
 * Legs completed over legs ordered, plus part credit for the leg under way,
 * measured from the waypoint the boat left. The first leg gets no part credit,
 * because a mission does not record where the boat started from and guessing
 * would be reporting a number the state cannot support.
 */
export function routeProgress(mission: Mission, position: Position, legIndex: number): number {
  const legs = mission.waypoints.length;
  if (legs === 0) return 1;

  const index = Math.max(0, Math.min(legIndex, legs));
  if (index >= legs) return 1;

  let credit = index;
  const from = index > 0 ? mission.waypoints[index - 1] : null;
  if (from) {
    const legNm = distanceBetween(from, mission.waypoints[index]);
    const goneNm = distanceBetween(from, position);
    if (legNm > 0) credit += Math.max(0, Math.min(goneNm / legNm, 1));
  }

  return Math.max(0, Math.min(credit / legs, 1));
}

function targetName(
  follow: FollowRecord,
  inputs: ActivityInputs,
  fleet: Fleet,
): string {
  if (follow.targetBoatId) {
    return fleet.definitions[follow.targetBoatId]?.name ?? follow.targetBoatId.toUpperCase();
  }

  const contact = inputs.contacts?.find(({ mmsi }) => mmsi === follow.targetMmsi);
  return contact?.name ?? (follow.targetMmsi === null ? "its target" : `MMSI ${follow.targetMmsi}`);
}

/** One line per hull, ordered faults first so a problem cannot scroll away. */
export function summariseActivity(fleet: Fleet, inputs: ActivityInputs = {}): ActivitySummary {
  const { links = {}, follows = [] } = inputs;
  const boats = Object.values(fleet.boats);

  const entries: ActivityEntry[] = boats.map((boat) => {
    const definition = fleet.definitions[boat.id];
    const name = definition?.name ?? boat.id.toUpperCase();
    const ratedKnots = definition?.maximumSpeedKnots ?? 0;
    const mission = boat.missionId ? fleet.missions[boat.missionId] ?? null : null;
    const waypoint = mission?.waypoints[boat.waypointIndex] ?? null;
    const moving = boat.speedKnots > MOVING_KNOTS;
    const lost = links[boat.id] === "LOST";

    // Where it is going. A station-keeping hull that has arrived is not going
    // anywhere, and saying "0.00 NM" would hide that it is parked on purpose.
    let where = "—";
    let eta = "—";
    if (waypoint) {
      const rangeNm = distanceBetween(boat.position, waypoint);
      if (mission?.stationKeeping && rangeNm < 0.05) {
        where = "On station";
        eta = "holding";
      } else {
        where = `${compass(bearingBetween(boat.position, waypoint))} · ${rangeNm.toFixed(2)} NM`;
        eta = moving ? formatEta(rangeNm / boat.speedKnots) : "stopped";
      }
    }

    let headline: string;
    let kind: ActivityKind;

    if (lost) {
      headline = "Link lost · holding onboard";
      kind = "FAULT";
      where = "Last reported position";
      eta = "—";
    } else if (boat.mode === "MANUAL") {
      headline = "Under manual helm";
      kind = "MANUAL";
    } else if (mission) {
      const follow = follows.find((record) => record.missionId === mission.id);
      if (follow) {
        headline = `${follow.mode === "ESCORT" ? "Escorting" : "Monitoring"} ${targetName(follow, inputs, fleet)}`;
      } else if (mission.objective) {
        headline = mission.loop
          ? `${OBJECTIVE_WORK[mission.objective.kind] ?? "Tasked"} · circuit`
          : OBJECTIVE_WORK[mission.objective.kind] ?? "Tasked";
      } else {
        headline = ROLE_WORK[mission.role] ?? "Tasked";
      }
      kind = moving ? "MOVING" : "HOLDING";
    } else if (boat.mode === "HOLD") {
      headline = "Holding, mission complete";
      kind = "HOLDING";
    } else {
      headline = "Idle, awaiting tasking";
      kind = "IDLE";
    }

    return {
      boatId: boat.id,
      name,
      headline,
      where,
      eta,
      progress: mission ? routeProgress(mission, boat.position, boat.waypointIndex) : null,
      effort: ratedKnots === 0 ? 0 : Math.min(Math.abs(boat.speedKnots) / ratedKnots, 1),
      speedKnots: boat.speedKnots,
      kind,
    };
  });

  const WEIGHT: Record<ActivityKind, number> = {
    FAULT: 0, MANUAL: 1, MOVING: 2, HOLDING: 3, IDLE: 4,
  };
  entries.sort((a, b) => WEIGHT[a.kind] - WEIGHT[b.kind] || a.name.localeCompare(b.name));

  const underway = entries.filter((entry) => entry.speedKnots > MOVING_KNOTS).length;
  const effortTotal = entries.reduce((sum, entry) => sum + entry.effort, 0);

  return {
    entries,
    underway,
    total: entries.length,
    tasked: boats.filter((boat) => boat.missionId !== null).length,
    effort: entries.length === 0 ? 0 : effortTotal / entries.length,
    faults: entries.filter((entry) => entry.kind === "FAULT").length,
  };
}
