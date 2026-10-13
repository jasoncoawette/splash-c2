import type { BoatDefinition, Mission, Position } from "./types";

function requireNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
}

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

export function assertPosition(position: Position): void {
  requireFinite(position.latitude, "Latitude");
  requireFinite(position.longitude, "Longitude");

  if (position.latitude < -90 || position.latitude > 90) {
    throw new Error("Latitude must be between -90 and 90");
  }

  if (position.longitude < -180 || position.longitude > 180) {
    throw new Error("Longitude must be between -180 and 180");
  }
}

export function assertBoatDefinition(definition: BoatDefinition): void {
  requireNonEmpty(definition.id, "Boat ID");
  requireNonEmpty(definition.name, "Boat name");
  requireFinite(definition.maximumSpeedKnots, "Maximum speed");
  requireFinite(definition.maximumRangeNm, "Maximum range");

  if (definition.maximumSpeedKnots <= 0) {
    throw new Error("Maximum speed must be greater than zero");
  }

  if (definition.maximumRangeNm <= 0) {
    throw new Error("Maximum range must be greater than zero");
  }
}

export function assertMission(mission: Mission): void {
  requireNonEmpty(mission.id, "Mission ID");

  if (mission.waypoints.length === 0) {
    throw new Error("Mission requires at least one waypoint");
  }

  mission.waypoints.forEach(assertPosition);

  if (mission.objective) {
    requireNonEmpty(mission.objective.label, "Mission objective label");
    assertPosition(mission.objective.position);
  }

  if (
    mission.cruiseKnots !== undefined &&
    (!Number.isFinite(mission.cruiseKnots) || mission.cruiseKnots <= 0)
  ) {
    throw new Error("Mission cruise speed must be greater than zero");
  }
}
