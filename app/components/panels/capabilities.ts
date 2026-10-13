import type { BoatState, BoatType } from "../../core/types";
import { specFor } from "../vessel/spec.ts";

// WHAT A HULL CARRIES
//
// Derived from the vessel spec rather than listed by hand, so a card cannot
// claim a sensor the model does not have. The Typhoon's tower is the only
// difference between the classes, so it is the only thing that changes the
// fitted list.

export type CapabilityId = "EO" | "COMMS" | "DECK" | "DRIVE" | "HELM" | "TASKED";

export interface Capability {
  id: CapabilityId;
  label: string;
}

export const CAPABILITY_LABEL: Record<CapabilityId, string> = {
  EO: "Electro-optical turret",
  COMMS: "Masthead antennas",
  DECK: "Payload deck",
  DRIVE: "Twin drives",
  HELM: "Under manual helm",
  TASKED: "Running a mission",
};

/** What the platform is fitted with, before anything an operator has done. */
export function fittedCapabilities(type: BoatType): CapabilityId[] {
  const spec = specFor(type);
  const fitted: CapabilityId[] = ["DECK", "DRIVE"];

  // Both sensors hang off the tower, so a flat-decked hull has neither.
  if (spec.tower) fitted.unshift("EO", "COMMS");
  return fitted;
}

/** Fitted equipment plus what the boat is doing with it right now. */
export function capabilitiesOf(type: BoatType, state: BoatState): CapabilityId[] {
  const live = fittedCapabilities(type);

  if (state.mode === "MANUAL") live.push("HELM");
  if (state.missionId !== null) live.push("TASKED");
  return live;
}
