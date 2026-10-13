import type { BoatDefinition, BoatState, Position } from "./types";
import { assertBoatDefinition, assertPosition } from "./validation.ts";

export function createBoatState(
  definition: BoatDefinition,
  position: Position,
): BoatState {
  assertBoatDefinition(definition);
  assertPosition(position);

  return {
    id: definition.id,
    position: { ...position },
    headingDegrees: 0,
    speedKnots: 0,
    energyPercent: 100,
    mode: "IDLE",
    role: null,
    missionId: null,
    waypointIndex: 0,
  };
}
