import type { BoatRole, Mission, MissionId, Position } from "./types";
import { advanceAlongHeading } from "./navigation.ts";
import { assertPosition } from "./validation.ts";

/**
 * Escorting and monitoring differ from the objective patterns in one way that
 * changes the shape of the problem: the thing being tasked moves. A station is
 * therefore planned in the TARGET's frame rather than in the world, and the
 * adapter re-plans it as the target runs. Each plan is one waypoint, because a
 * boat holding station on a moving ship is always steering at where that ship
 * is now, not working through a route it was given a minute ago.
 */
export type FollowMode = "ESCORT" | "MONITOR";

export interface FollowModeSpec {
  mode: FollowMode;
  role: BoatRole;
  label: string;
  summary: string;
  /** Default distance the screen is held off the target, in nautical miles. */
  standoffNm: number;
}

export const FOLLOW_MODES: readonly FollowModeSpec[] = [
  {
    mode: "ESCORT",
    role: "PATROL",
    label: "Escort",
    summary: "Hold a screening station on the contact and run with it",
    standoffNm: 0.35,
  },
  {
    mode: "MONITOR",
    role: "RECON",
    label: "Monitor",
    summary: "Shadow the contact from a standoff ring",
    standoffNm: 1.1,
  },
];

export interface FollowPlanInput {
  missionId: MissionId;
  mode: FollowMode;
  target: Position;
  /** The target's course, used to place an escort screen around its track. */
  targetHeadingDegrees: number;
  slot: number;
  groupSize: number;
  standoffNm: number;
}

export function followModeSpec(mode: FollowMode): FollowModeSpec {
  const spec = FOLLOW_MODES.find((entry) => entry.mode === mode);

  if (!spec) {
    throw new Error(`Unknown follow mode: ${mode}`);
  }

  return spec;
}

/**
 * Escort stations ring the contact but are biased ahead of it, because a screen
 * is worth most across the track the contact is about to take. Monitor stations
 * spread evenly around a wider ring and ignore the contact's course.
 */
function stationBearing(
  mode: FollowMode,
  targetHeadingDegrees: number,
  slot: number,
  groupSize: number,
): number {
  if (mode === "MONITOR") {
    return (360 / groupSize) * slot;
  }

  // Alternate port and starboard of the track, opening the angle astern as the
  // group grows, so two boats sit abeam and later boats fall back as a screen.
  const side = slot % 2 === 0 ? -1 : 1;
  const rank = Math.floor(slot / 2);
  const offset = 55 + rank * 40;

  return targetHeadingDegrees + side * Math.min(offset, 150);
}

export function planFollow(input: FollowPlanInput): Mission {
  assertPosition(input.target);

  if (!Number.isFinite(input.targetHeadingDegrees)) {
    throw new Error("Target heading must be a finite number");
  }

  if (!Number.isInteger(input.slot) || input.slot < 0) {
    throw new Error("Follow slot must be a non-negative integer");
  }

  if (!Number.isInteger(input.groupSize) || input.groupSize < 1) {
    throw new Error("Follow group size must be at least one boat");
  }

  if (input.slot >= input.groupSize) {
    throw new Error("Follow slot must be inside the tasked group");
  }

  if (!Number.isFinite(input.standoffNm) || input.standoffNm <= 0) {
    throw new Error("Follow standoff must be greater than zero");
  }

  const spec = followModeSpec(input.mode);
  const bearing = stationBearing(
    input.mode,
    input.targetHeadingDegrees,
    input.slot,
    input.groupSize,
  );

  return {
    id: input.missionId,
    role: spec.role,
    waypoints: [advanceAlongHeading(input.target, bearing, input.standoffNm)],
    objective: {
      kind: input.mode === "ESCORT" ? "ESCORT_TARGET" : "MONITOR_TARGET",
      position: { ...input.target },
      label: input.mode === "ESCORT"
        ? "Park beside the live contact and move when it moves"
        : "Hold a monitoring station around the live contact",
    },
    stationKeeping: true,
  };
}
