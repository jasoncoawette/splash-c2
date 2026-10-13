import type {
  BoatState,
  Mission,
} from "./types";
import { assertMission } from "./validation.ts";

export function assignMission(
  boat: BoatState,
  mission: Mission,
): BoatState {
  assertMission(mission);

  return {
    ...boat,
    missionId: mission.id,
    role: mission.role,
    waypointIndex: 0,
    mode: "MISSION",
  };
}
