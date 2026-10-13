"use client";

import { useEffect, useState } from "react";

import { bearingBetween, distanceBetween } from "../../core/navigation.ts";
import type { BoatDefinition, BoatState, BoatType, Mission, Position } from "../../core/types";
import type { HelmCamera, OrbitState } from "../../store/commandSlice.ts";
import HelmStage, { type HelmTheme } from "./HelmStage";
import { useHelmKeys } from "./useHelmKeys.ts";
import HeadingTape from "./HeadingTape";
import HelmMap from "./HelmMap";
import { contactsAhead, timeToPoint } from "./frame";
import { ballastBalance } from "../vessel/subsystems.ts";
import "./helmStage.css";

/**
 * Metres of turning circle per knot of rated speed at one radian of rudder. A
 * shaped demo constant, not a hydrodynamic figure.
 */
const TRUE_LENGTH_FACTOR = 1.6;

/** How wide a view the contacts list covers. The stage itself draws all round. */
const CONTACT_FIELD_OF_VIEW = 220;


export interface HelmNeighbour {
  id: string;
  name: string;
  type: BoatType;
  speedKnots: number;
  headingDegrees: number;
  position: Position;
}

interface HelmViewProps {
  boat: BoatState;
  definition: BoatDefinition;
  mission: Mission | null;
  neighbours: readonly HelmNeighbour[];
  rudderDegrees: number;
  /** The objective the fleet is working to, and the water it claims. */
  objective: Position | null;
  objectiveRadiusNm: number;
  camera: HelmCamera;
  orbit: OrbitState;
  theme: HelmTheme;
  onOrbit: (delta: { yaw?: number; pitch?: number; distance?: number }) => void;
  onToggleManual: (manual: boolean) => void;
  onRecall: () => void;
  onZoomOut: () => void;
}

function courseToNextWaypoint(boat: BoatState, mission: Mission | null): number | null {
  const waypoint = mission?.waypoints[boat.waypointIndex];

  return waypoint ? bearingBetween(boat.position, waypoint) : null;
}

/**
 * The view an operator gets after taking a single boat. The hull is the subject:
 * it sits in the middle of everything the console knows about — contacts at
 * their true bearing and aspect, the lane to the next waypoint, the sea moving
 * at the ordered speed — with its numbers over the top left and the chart in
 * the corner, so one screen answers both "what is around me" and "where am I".
 */
export default function HelmView({
  boat,
  definition,
  mission,
  neighbours,
  rudderDegrees,
  objective,
  objectiveRadiusNm,
  camera,
  orbit,
  theme,
  onOrbit,
  onToggleManual,
  onRecall,
  onZoomOut,
}: HelmViewProps) {
// W and S work the engine telegraph, A and D the rudder, X centres it,
  // and 1-4 pick a camera. Bound for as long as the helm is on screen.
  const manual = boat.mode === "MANUAL";
  useHelmKeys(manual);

  // Taking the helm is a transfer of control, so it is confirmed rather than
  // toggled. The confirmation is local state on purpose: it must not survive a
  // re-render of the view, let alone a reload.
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;

    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirming(false);
    };

    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [confirming]);

  const contacts = contactsAhead(
    boat.position,
    boat.headingDegrees,
    neighbours,
    CONTACT_FIELD_OF_VIEW,
  );
  const course = courseToNextWaypoint(boat, mission);

  // The leg readout needs the range to the next waypoint and nothing else.
  // The stage draws the route itself, from the same waypoints, on the map.
  const waypoint = mission?.waypoints[boat.waypointIndex] ?? null;
  const lane = waypoint
    ? { distanceNm: distanceBetween(boat.position, waypoint) }
    : null;

  // Under autopilot the rudder shown is the course error the boat is working
  // off; under manual control it is what the operator has ordered.
  const shownRudder = manual
    ? rudderDegrees
    : course === null
      ? 0
      : Math.max(Math.min(((course - boat.headingDegrees + 540) % 360) - 180, 35), -35);

  // Demo assumptions, both derived rather than measured, and labelled as such:
  // the turn radius comes from the ordered rudder on a simple steering model,
  // and reserve buoyancy from how much hull is still above water, which falls
  // as the boat drives bow-down. Neither is platform data.
  const turnRadiusM = Math.abs(shownRudder) < 1
    ? null
    : TRUE_LENGTH_FACTOR * definition.maximumSpeedKnots
      / Math.tan((Math.abs(shownRudder) * Math.PI) / 180);
  const buoyancyPercent = Math.max(
    0,
    Math.min(100, 100 - (Math.abs(boat.speedKnots) / definition.maximumSpeedKnots) * 14),
  );
  // One owner for the ballast estimate: the systems windows report the same
  // port/starboard split, and two copies of one model would eventually
  // disagree about the same hull.
  const { portPercent: portBallast, starboardPercent: starboardBallast } = ballastBalance(
    boat.speedKnots,
    definition.maximumSpeedKnots,
    shownRudder,
  );

  return (
    <section className="helm-screen" aria-label={`Helm station ${definition.name}`}>
      <div className="helm-stage">
        <HelmStage
          boatId={boat.id}
          name={definition.name}
          type={definition.type}
          position={boat.position}
          headingDegrees={boat.headingDegrees}
          speedKnots={boat.speedKnots}
          neighbours={neighbours}
          mission={mission}
          waypointIndex={boat.waypointIndex}
          objective={objective}
          objectiveRadiusNm={objectiveRadiusNm}
          theme={theme}
          camera={camera}
          orbit={orbit}
          onOrbit={onOrbit}
        />

        <div className="helm-cluster">
          <p className={`helm-mode${manual ? " is-manual" : ""}`}>
            {manual ? "Manual helm" : "Autopilot"}
          </p>

          <p className="helm-name">
            <strong>{definition.name}</strong>
            <span>{definition.type} · {boat.id}</span>
          </p>

          <div className="helm-readout">
            <div className="helm-speed">
              <strong>{boat.speedKnots.toFixed(1)}</strong>
              <span>kn{boat.speedKnots < 0 ? " astern" : ""}</span>
            </div>

            <div className="helm-battery" title={`${boat.energyPercent.toFixed(0)}% charge`}>
              <svg viewBox="0 0 24 14" aria-hidden="true">
                <rect x="0.75" y="0.75" width="19.5" height="12.5" rx="2" />
                <path d="M22 5 L22 9" />
                <rect
                  className="helm-battery-fill"
                  data-low={boat.energyPercent < 25 ? "true" : "false"}
                  x="2.5"
                  y="2.5"
                  width={Math.max(0.5, (boat.energyPercent / 100) * 16)}
                  height={9}
                  rx="1"
                />
              </svg>
              <em>{boat.energyPercent.toFixed(0)}%</em>
            </div>
          </div>

          <dl className="helm-derived">
            <div>
              <dt>Turn radius</dt>
              <dd>{turnRadiusM === null ? "—" : `${Math.round(turnRadiusM)} m`}</dd>
            </div>
            <div>
              <dt>Buoyancy</dt>
              <dd>{buoyancyPercent.toFixed(0)}%</dd>
            </div>
          </dl>
        </div>

        <div className="helm-leg">
          {lane ? (
            <>
              <strong>{lane.distanceNm.toFixed(2)} NM</strong>
              <span>
                Waypoint {boat.waypointIndex + 1} of {mission?.waypoints.length ?? 0} ·{" "}
                {timeToPoint(lane.distanceNm, boat.speedKnots)}
              </span>
              <span className="helm-leg-progress" aria-hidden="true">
                <span
                  style={{
                    width: `${mission && mission.waypoints.length > 0
                      ? (boat.waypointIndex / mission.waypoints.length) * 100
                      : 0}%`,
                  }}
                />
              </span>
            </>
          ) : (
            <>
              <strong>No leg</strong>
              <span>Route the vessel from the fleet chart</span>
            </>
          )}
        </div>

        <HeadingTape
          headingDegrees={boat.headingDegrees}
          courseDegrees={course}
          nearestContact={contacts[0] ?? null}
        />
      </div>

      <aside className="helm-side">
        <HelmMap
          position={boat.position}
          headingDegrees={boat.headingDegrees}
          mission={mission}
          waypointIndex={boat.waypointIndex}
          objective={objective}
          objectiveRadiusNm={objectiveRadiusNm}
          theme={theme}
        />

        <section className="helm-ballast" aria-label="Estimated ballast balance">
          <header>
            <span>Ballast</span>
            <strong>Auto · sim est</strong>
          </header>
          <div className="helm-ballast-tanks" aria-hidden="true">
            <span className="helm-ballast-tank">
              <i style={{ height: `${portBallast}%` }} />
            </span>
            <span className="helm-ballast-keel" />
            <span className="helm-ballast-tank">
              <i style={{ height: `${starboardBallast}%` }} />
            </span>
          </div>
          <div className="helm-ballast-values">
            <span>Port {portBallast.toFixed(0)}%</span>
            <span>Stbd {starboardBallast.toFixed(0)}%</span>
          </div>
        </section>
      </aside>

      <footer className="helm-dock">
        <button
          className={`ghost-button${manual ? " is-live" : ""}`}
          type="button"
          onClick={() => (manual ? onToggleManual(false) : setConfirming(true))}
        >
          {manual ? "Release helm" : "Take the helm"}
        </button>
        <button
          className="ghost-button"
          type="button"
          onClick={onRecall}
          disabled={boat.missionId === null}
        >
          Recall
        </button>
        <button className="ghost-button is-primary" type="button" onClick={onZoomOut}>
          Zoom out · fleet
        </button>
      </footer>

      {confirming && (
        <div
          className="helm-confirm"
          role="dialog"
          aria-modal="true"
          aria-label="Take manual control"
        >
          <div className="helm-confirm-card">
            <p className="helm-confirm-mark" aria-hidden="true">!</p>
            <h2>Take manual control</h2>
            <p>
              {definition.name} leaves autopilot and stops working its route. It holds whatever
              heading and telegraph you give it from this station, and keeps its mission until
              the helm is released.
            </p>
            <div className="helm-confirm-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => setConfirming(false)}
                autoFocus
              >
                Cancel
              </button>
              <button
                className="ghost-button is-primary"
                type="button"
                onClick={() => {
                  onToggleManual(true);
                  setConfirming(false);
                }}
              >
                Take control
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
