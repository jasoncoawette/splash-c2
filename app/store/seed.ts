import type { BoatDefinition, BoatType, Position } from "../core/types";

// SEED DATA AND SIMULATION CONSTANTS
//
// Lifted out of the dashboard so the store, the tests and any future adapter
// all start from the same fleet rather than from a component's useState.

// Demo assumption: speed and range figures are placeholders until verified
// platform data is available. The requirement ledger records them as inert.
export const CLASS_SPEC: Record<
  BoatType,
  { speedKnots: number; rangeNm: number; prefix: string }
> = {
  TYPHOON: { speedKnots: 45, rangeNm: 400, prefix: "TY" },
  TEMPEST: { speedKnots: 38, rangeNm: 900, prefix: "TP" },
};

export const INITIAL_BOATS = [
  {
    definition: {
      id: "typhoon-01",
      name: "TY-01 Vanguard",
      type: "TYPHOON" as const,
      maximumSpeedKnots: 45,
      maximumRangeNm: 400,
    },
    position: { latitude: 33.718, longitude: -118.26 },
  },
  {
    definition: {
      id: "typhoon-02",
      name: "TY-02 Sentinel",
      type: "TYPHOON" as const,
      maximumSpeedKnots: 45,
      maximumRangeNm: 400,
    },
    position: { latitude: 33.7055, longitude: -118.236 },
  },
  {
    definition: {
      id: "tempest-01",
      name: "TP-01 Bastion",
      type: "TEMPEST" as const,
      maximumSpeedKnots: 38,
      maximumRangeNm: 900,
    },
    position: { latitude: 33.7155, longitude: -118.193 },
  },
];

// Demo assumption: fixed anchorages in open water across San Pedro Bay.
// Every coordinate here and in INITIAL_BOATS was checked against the Mapbox
// Streets `water` layer with queryRenderedFeatures, not estimated by eye.
export const CREATION_POSITIONS: readonly Position[] = [
  { latitude: 33.712, longitude: -118.256 },
  { latitude: 33.7005, longitude: -118.214 },
  { latitude: 33.724, longitude: -118.182 },
  { latitude: 33.726, longitude: -118.205 },
  { latitude: 33.696, longitude: -118.242 },
  { latitude: 33.7085, longitude: -118.196 },
];

/** The fixed delta handed to the core on every tick. The core reads no clock. */
export const TICK_SECONDS = 0.1;

/** Degrees of turn per second for every degree of rudder ordered. */
export const RUDDER_RATE = 0.08;

export const GROUP_NAMES = "ABCDEFGH";

export function createDefinition(type: BoatType, hullNumber: number): BoatDefinition {
  const spec = CLASS_SPEC[type];
  const padded = String(hullNumber).padStart(2, "0");

  return {
    id: `${type.toLowerCase()}-${padded}`,
    name: `${spec.prefix}-${padded} ${type.charAt(0)}${type.slice(1).toLowerCase()}`,
    type,
    maximumSpeedKnots: spec.speedKnots,
    maximumRangeNm: spec.rangeNm,
  };
}
