import type { BoatDefinition, BoatState } from "../../core/types";
import { specFor, deckHalfBeam, DECK_BOW_STATION, DECK_STERN_STATION } from "./spec.ts";
import type { VesselSpec } from "./spec.ts";

// WHAT EACH PART OF THE HULL IS DOING
//
// `capabilities.ts` answers "is this fitted". This answers "and what is it
// doing right now", one entry per part of the drawing, so an operator can open
// a window on the drive or the turret rather than reading one flat block of
// numbers for the whole boat.
//
// Two rules hold this file honest.
//
// A part that is not on the hull has no entry: the list is derived from the
// same `VesselSpec` the Three.js model and the side elevation are generated
// from, so a window cannot report a turret on a flat-decked Tempest.
//
// Nothing here is measured. Position, heading, speed, charge, mode and
// waypoint come from the simulator; every other number is derived from those
// on a stated model and carries `estimated`, which the window prints as
// SIM EST. The ledger rule is that a made-up value must not look measured.
//
// Pure: no store, no clock, no React. `elapsedSeconds` is handed in from
// telemetry, so a replay of the same run shows the same readings.

export type SubsystemId =
  | "DRIVE"
  | "STEERING"
  | "POWER"
  | "HULL"
  | "DECK"
  | "TURRET"
  | "COMMS"
  | "NAV";

/**
 * What the window's status light says. ACTIVE is the part doing work, NOMINAL
 * is fitted and healthy with nothing asked of it, STANDBY is powered and
 * waiting, DEGRADED is working but outside its comfortable band, and OFFLINE
 * is not answering.
 */
export type SubsystemStatus = "ACTIVE" | "NOMINAL" | "STANDBY" | "DEGRADED" | "OFFLINE";

export interface SubsystemChannel {
  label: string;
  value: string;
  /** Derived for the demo rather than measured. The window labels these. */
  estimated?: boolean;
}

export interface Subsystem {
  id: SubsystemId;
  label: string;
  /** The `ProfilePart` ids this part owns, so the drawing can light up with it. */
  partIds: readonly string[];
  /**
   * Where the part sits, in model metres: +y forward, +z up, the same frame
   * `buildProfile` works in. The schematic turns this into a pin position, so
   * a pin cannot drift away from the thing it points at.
   */
  anchor: { y: number; z: number };
  status: SubsystemStatus;
  /** One line: what the part is doing, in the operator's words. */
  summary: string;
  channels: readonly SubsystemChannel[];
  /** How hard it is working, 0..1, for the bar across the window. */
  load: number;
}

export interface SubsystemContext {
  /** Ordered rudder in degrees, positive to starboard. */
  rudderDegrees?: number;
  /** False once the radio link to the hull is lost. */
  linked?: boolean;
  /** Simulated seconds, from telemetry: the only reason a reading moves. */
  elapsedSeconds?: number;
  /** Leg of the route, already formatted by the caller that owns the mission. */
  legLabel?: string | null;
  objectiveLabel?: string | null;
}

export const SUBSYSTEM_ORDER: readonly SubsystemId[] = [
  "DRIVE", "STEERING", "POWER", "HULL", "DECK", "TURRET", "COMMS", "NAV",
];

const RUDDER_LIMIT = 35;

/** Rated shaft speed at full ahead. A demo figure, not platform data. */
const FULL_AHEAD_RPM = 4200;

/** Rated electrical draw at full ahead, in kilowatts. Also a demo figure. */
const FULL_AHEAD_KW = 38;

/**
 * A small, repeatable wander so a reading looks live without being invented
 * fresh each frame. Deterministic in its seed and in simulated time, which is
 * what keeps a replay identical — `Math.random()` here would make the console
 * unreplayable for the sake of a wobbling digit.
 */
function wander(seed: number, elapsedSeconds: number, amplitude: number): number {
  return Math.sin(elapsedSeconds * 0.7 + seed * 1.7) * amplitude;
}

/** Station in metres from midships, from a fraction of length off the transom. */
function station(spec: VesselSpec, t: number): number {
  return -spec.lengthM / 2 + t * spec.lengthM;
}

function signed(value: number, digits = 0): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}`;
}

/**
 * Ballast balance, port and starboard, as percentages.
 *
 * The one owner for the estimate the helm already showed: the hull leans with
 * the rudder, in proportion to how fast it is going. Straight and level reads
 * 50/50. Exported because the helm's ballast display reads the same number.
 */
export function ballastBalance(
  speedKnots: number,
  maximumSpeedKnots: number,
  rudderDegrees: number,
): { portPercent: number; starboardPercent: number; shift: number } {
  const speedRatio = maximumSpeedKnots === 0
    ? 0
    : Math.min(Math.abs(speedKnots) / maximumSpeedKnots, 1);
  const shift = Math.max(-8, Math.min(8, (rudderDegrees / RUDDER_LIMIT) * speedRatio * 8));

  return { portPercent: 50 - shift, starboardPercent: 50 + shift, shift };
}

/**
 * Every part on this hull, with what it is doing.
 *
 * Order is `SUBSYSTEM_ORDER` filtered to what is fitted, so the pins and the
 * windows are always in the same order whatever the class.
 */
export function subsystemsOf(
  definition: BoatDefinition,
  state: BoatState,
  context: SubsystemContext = {},
): Subsystem[] {
  const spec = specFor(definition.type);
  const {
    rudderDegrees = 0,
    linked = true,
    elapsedSeconds = 0,
    legLabel = null,
    objectiveLabel = null,
  } = context;

  const scale = spec.lengthM / 3.9;
  const sternY = -spec.lengthM / 2;
  const speedRatio = definition.maximumSpeedKnots === 0
    ? 0
    : Math.min(Math.abs(state.speedKnots) / definition.maximumSpeedKnots, 1);
  const working = state.mode === "MISSION" || state.mode === "MANUAL";
  const rudder = Math.max(-RUDDER_LIMIT, Math.min(RUDDER_LIMIT, rudderDegrees));
  const ballast = ballastBalance(state.speedKnots, definition.maximumSpeedKnots, rudder);

  const parts: Subsystem[] = [];

  // -- drives: two of them, and the rudder differential tells them apart -----
  //
  // A turn loads the outboard drive and unloads the inboard one, so the two
  // shafts are reported separately. One combined number would hide the only
  // thing a twin-screw readout is for.
  const baseRpm = speedRatio * FULL_AHEAD_RPM;
  const differential = (rudder / RUDDER_LIMIT) * baseRpm * 0.12;
  // The wander is small on purpose: it has to be visibly less than the
  // differential, or the only thing a twin-screw readout is for — which shaft
  // is taking the turn — would be buried in noise. It is also gated on the
  // boat actually moving: a stopped hull reporting 6 rpm reads as a fault in
  // the readout rather than as a stopped boat.
  const turning = baseRpm > 0;
  const portRpm = turning
    ? Math.max(0, baseRpm + differential + wander(1, elapsedSeconds, 8))
    : 0;
  const starboardRpm = turning
    ? Math.max(0, baseRpm - differential + wander(2, elapsedSeconds, 8))
    : 0;

  parts.push({
    id: "DRIVE",
    label: "Twin drives",
    partIds: ["drive", "stern-beam"],
    anchor: { y: sternY - 0.1 * scale, z: -spec.draftM * 0.6 },
    status: state.speedKnots > 0.2 ? "ACTIVE" : linked ? "STANDBY" : "OFFLINE",
    summary: state.speedKnots > 0.2
      ? `Making ${state.speedKnots.toFixed(1)} kn of ${definition.maximumSpeedKnots} rated`
      : "Stopped, drives idling",
    load: speedRatio,
    channels: [
      { label: "Demand", value: `${(speedRatio * 100).toFixed(0)}%` },
      { label: "Port shaft", value: `${portRpm.toFixed(0)} rpm`, estimated: true },
      { label: "Stbd shaft", value: `${starboardRpm.toFixed(0)} rpm`, estimated: true },
    ],
  });

  // -- steering --------------------------------------------------------------
  parts.push({
    id: "STEERING",
    label: "Steering",
    partIds: ["drive"],
    anchor: { y: sternY + 0.2 * scale, z: spec.deckM * 0.42 },
    status: Math.abs(rudder) >= 1 ? "ACTIVE" : "NOMINAL",
    summary: Math.abs(rudder) < 1
      ? "Rudder amidships"
      : `${Math.abs(rudder).toFixed(0)}° ${rudder > 0 ? "starboard" : "port"}`,
    load: Math.abs(rudder) / RUDDER_LIMIT,
    channels: [
      { label: "Rudder", value: `${signed(rudder)}°` },
      { label: "Heading", value: `${state.headingDegrees.toFixed(0)}°` },
      { label: "Control", value: state.mode === "MANUAL" ? "Helm" : "Autopilot" },
    ],
  });

  // -- power -----------------------------------------------------------------
  //
  // Endurance is range remaining over speed made good, which is only a figure
  // while the boat is moving; stopped, the honest answer is a dash rather than
  // an infinity dressed up as hours.
  const rangeRemainingNm = definition.maximumRangeNm * (state.energyPercent / 100);
  const enduranceHours = state.speedKnots > 0.2 ? rangeRemainingNm / state.speedKnots : null;
  const drawKw = FULL_AHEAD_KW * speedRatio ** 2 + 1.2;

  parts.push({
    id: "POWER",
    label: "Power",
    // No parts: the battery is under the deck and the drawing does not contain
    // it. Lighting up the hull outline would say the hull is the thing being
    // reported on, so the pin carries this one on its own.
    partIds: [],
    anchor: { y: station(spec, 0.3), z: spec.deckM * 0.3 },
    status: state.energyPercent < 20 ? "DEGRADED" : working ? "ACTIVE" : "NOMINAL",
    summary: state.energyPercent < 20
      ? `Charge low: ${state.energyPercent.toFixed(0)}%`
      : `${rangeRemainingNm.toFixed(1)} NM of range in the bank`,
    load: state.energyPercent / 100,
    channels: [
      { label: "Charge", value: `${state.energyPercent.toFixed(0)}%` },
      { label: "Draw", value: `${drawKw.toFixed(1)} kW`, estimated: true },
      {
        label: "Endurance",
        value: enduranceHours === null ? "—" : `${enduranceHours.toFixed(1)} h`,
        estimated: true,
      },
    ],
  });

  // -- hull and ballast ------------------------------------------------------
  parts.push({
    id: "HULL",
    label: "Hull & ballast",
    partIds: ["hull", "chine", "waterline"],
    anchor: { y: station(spec, 0.52), z: -spec.draftM * 0.75 },
    status: Math.abs(ballast.shift) > 6 ? "DEGRADED" : "NOMINAL",
    summary: Math.abs(ballast.shift) < 0.5
      ? "Upright and level"
      : `Leaning ${ballast.shift > 0 ? "starboard" : "port"} in the turn`,
    load: Math.abs(ballast.shift) / 8,
    channels: [
      { label: "Draft", value: `${spec.draftM.toFixed(2)} m` },
      { label: "Port tank", value: `${ballast.portPercent.toFixed(0)}%`, estimated: true },
      { label: "Stbd tank", value: `${ballast.starboardPercent.toFixed(0)}%`, estimated: true },
    ],
  });

  // -- payload deck ----------------------------------------------------------
  //
  // Geometry, not telemetry: the deck's own numbers come straight off the spec,
  // so none of them is an estimate.
  const deckLengthM = (DECK_BOW_STATION - DECK_STERN_STATION) * spec.lengthM;
  const deckBeamM = deckHalfBeam(spec) * 2;

  parts.push({
    id: "DECK",
    label: "Payload deck",
    partIds: ["deck"],
    anchor: { y: station(spec, 0.68), z: spec.deckM * 1.04 },
    status: state.missionId === null ? "NOMINAL" : "ACTIVE",
    summary: state.missionId === null
      ? "Clear, nothing tasked"
      : objectiveLabel ?? "Tasked",
    load: state.missionId === null ? 0 : 1,
    channels: [
      { label: "Area", value: `${(deckLengthM * deckBeamM).toFixed(2)} m²` },
      { label: "Clear length", value: `${deckLengthM.toFixed(2)} m` },
      { label: "Clear beam", value: `${deckBeamM.toFixed(2)} m` },
    ],
  });

  // -- the tower, and the two things that hang off it ------------------------
  //
  // Only on a hull that has one. A flat-decked Tempest gets neither window,
  // for the same reason its card shows neither capability.
  if (spec.tower) {
    const { station: towerStation, heightM: towerHeight, podRadiusM } = spec.tower;
    const towerY = station(spec, towerStation);
    const towerTop = spec.deckM + 0.03 * scale + towerHeight;

    // The turret trains on the leg the boat is flying, so the bearing it
    // reports is the course error it is holding off rather than a free number.
    const train = working ? rudder * -0.8 : 0;

    parts.push({
      id: "TURRET",
      label: "EO turret",
      partIds: ["sensor-pod", "tower-mast", "tower-housing"],
      anchor: { y: towerY, z: towerTop + podRadiusM },
      status: linked ? (working ? "ACTIVE" : "STANDBY") : "OFFLINE",
      summary: !linked
        ? "No link to the turret"
        : working
          ? "Trained on the leg ahead"
          : "Stowed fore and aft",
      load: working ? 0.72 : 0.12,
      channels: [
        { label: "Train", value: `${signed(train)}° rel`, estimated: true },
        { label: "Elevation", value: `${signed(-4 + wander(3, elapsedSeconds, 1.5), 1)}°`, estimated: true },
        { label: "Stabilised", value: linked ? "Yes" : "—", estimated: true },
      ],
    });

    parts.push({
      id: "COMMS",
      label: "Masthead comms",
      partIds: ["tower-arm", "tower-mast"],
      anchor: { y: towerY, z: towerTop - 0.26 * scale },
      status: linked ? "ACTIVE" : "OFFLINE",
      summary: linked ? "Link up" : "Link lost — hull is holding on its own",
      load: linked ? 0.86 : 0,
      channels: [
        { label: "Link", value: linked ? "Online" : "Lost" },
        {
          label: "Latency",
          value: linked ? `${(48 + wander(4, elapsedSeconds, 9)).toFixed(0)} ms` : "—",
          estimated: true,
        },
        {
          label: "Signal",
          value: linked ? `${(88 + wander(5, elapsedSeconds, 5)).toFixed(0)}%` : "0%",
          estimated: true,
        },
      ],
    });
  }

  // -- navigation ------------------------------------------------------------
  parts.push({
    id: "NAV",
    label: "Navigation",
    // As with POWER: the drawing has no antenna forward to light.
    partIds: [],
    anchor: { y: station(spec, 0.9), z: spec.deckM * 1.15 },
    status: linked ? (state.missionId === null ? "NOMINAL" : "ACTIVE") : "DEGRADED",
    summary: legLabel === null
      ? `${state.mode.charAt(0)}${state.mode.slice(1).toLowerCase()}, no route loaded`
      : `Leg ${legLabel}`,
    load: state.missionId === null ? 0 : 1,
    channels: [
      { label: "Latitude", value: `${state.position.latitude.toFixed(5)}°` },
      { label: "Longitude", value: `${state.position.longitude.toFixed(5)}°` },
      { label: "Fix", value: linked ? "GNSS" : "Dead reckoning", estimated: true },
    ],
  });

  const rank = new Map(SUBSYSTEM_ORDER.map((id, index) => [id, index]));
  return parts.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
}

/** True when any reading in the window is derived rather than measured. */
export function hasEstimate(part: Subsystem): boolean {
  return part.channels.some((channel) => channel.estimated === true);
}
