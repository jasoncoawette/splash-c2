export { assignMission } from "./assignMission.ts";
export { createBoatState } from "./createBoat.ts";
export {
  FOLLOW_MODES,
  followModeSpec,
  planFollow,
} from "./followTarget.ts";
export type {
  FollowMode,
  FollowModeSpec,
  FollowPlanInput,
} from "./followTarget.ts";
export {
  MISSION_PATTERNS,
  planMission,
} from "./missionPlanner.ts";
export type {
  MissionPattern,
  MissionPatternSpec,
  MissionPlanInput,
} from "./missionPlanner.ts";
export {
  advanceAlongHeading,
  bearingBetween,
  distanceBetween,
  moveToward,
} from "./navigation.ts";
export { stepBoat } from "./stepBoat.ts";
export type {
  BoatDefinition,
  BoatId,
  BoatMode,
  BoatRole,
  BoatState,
  BoatType,
  Fleet,
  Mission,
  MissionId,
  Position,
} from "./types";
