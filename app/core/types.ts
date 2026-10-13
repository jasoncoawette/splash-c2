// DOMAIN TYPES

export type BoatId = string;
export type MissionId = string;

export interface Position {
  latitude: number;
  longitude: number;
}

export type BoatType = "TYPHOON" | "TEMPEST";

export type BoatRole =
  | "PATROL"
  | "RECON"
  | "RESUPPLY";

// MANUAL is the operator taking the helm: the boat keeps its mission so it can
// be handed back to the autopilot, but it answers the throttle and rudder.
export type BoatMode =
  | "IDLE"
  | "MISSION"
  | "MANUAL"
  | "HOLD";

export interface BoatDefinition {
  id: BoatId;
  name: string;
  type: BoatType;
  maximumSpeedKnots: number;
  maximumRangeNm: number;
}

export interface BoatState {
  id: BoatId;
  position: Position;
  headingDegrees: number;
  speedKnots: number;
  energyPercent: number;
  mode: BoatMode;
  role: BoatRole | null;
  missionId: MissionId | null;
  waypointIndex: number;
}

export interface Mission {
  id: MissionId;
  role: BoatRole;
  waypoints: Position[];
  /** What success means, independent of the route used to get there. */
  objective?: {
    kind:
      | "MOVE_TO"
      | "PATROL_AREA"
      | "SEARCH_AREA"
      | "HOLD_POSITION"
      | "ESCORT_TARGET"
      | "MONITOR_TARGET";
    position: Position;
    label: string;
  };
  /** Speed to resume when a moving station advances after the boat has parked. */
  cruiseKnots?: number;
  /**
   * A station-keeping mission is never finished. Arriving holds the station and
   * waits for it to be moved, which is what following a contact needs: the boat
   * reaches its screen position long before the contact stops moving.
   */
  stationKeeping?: boolean;
  /**
   * A looping mission runs its waypoints as a circuit. A perimeter patrol that
   * stopped at the last corner would only ever cover the ring once.
   */
  loop?: boolean;
}


// AGGREGATES (collection of domain objects)

export interface Fleet {
  definitions: Record<BoatId, BoatDefinition>;
  boats: Record<BoatId, BoatState>;
  missions: Record<MissionId, Mission>;
}
