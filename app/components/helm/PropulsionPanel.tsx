"use client";

import { Arc, MeterBar, polarPoint, Readout } from "../instruments";

interface PropulsionPanelProps {
  speedKnots: number;
  maximumSpeedKnots: number;
  rudderDegrees: number;
  manual: boolean;
  onThrottle: (speedKnots: number) => void;
  onRudder: (degrees: number) => void;
}

/**
 * Demo assumption: shaft RPM, blade pitch and thruster demand are derived from
 * throttle and rudder rather than measured. The requirement ledger records the
 * derivation as an assumption until verified platform telemetry exists.
 */
function derive(speedKnots: number, maximumSpeedKnots: number, rudderDegrees: number) {
  const throttle = maximumSpeedKnots === 0 ? 0 : speedKnots / maximumSpeedKnots;
  // Astern is a direction, not a negative gauge: the dials read the demand and
  // the labels say which way the shaft is turning.
  const demand = Math.abs(throttle);

  return {
    throttle,
    demand,
    astern: throttle < 0,
    powerPercent: Math.round(demand * 100),
    rpm: Math.round(demand * 1150),
    pitchDegrees: Math.round(8 + demand * 24),
    portPercent: Math.round(Math.max(0, -rudderDegrees) * 1.6),
    starboardPercent: Math.round(Math.max(0, rudderDegrees) * 1.6),
  };
}

export default function PropulsionPanel({
  speedKnots,
  maximumSpeedKnots,
  rudderDegrees,
  manual,
  onThrottle,
  onRudder,
}: PropulsionPanelProps) {
  const { demand, astern, powerPercent, rpm, pitchDegrees, portPercent, starboardPercent } =
    derive(speedKnots, maximumSpeedKnots, rudderDegrees);
  const pitchFraction = Math.min(pitchDegrees / 32, 1);

  return (
    <section className="console-panel" aria-label="Main propulsion">
      <header className="console-panel-head">
        <h2>Main propulsion{astern ? " · astern" : ""}</h2>
        <span aria-hidden="true">▾</span>
      </header>

      <div className="propulsion-ring">
        <svg viewBox="0 0 220 220" role="img" aria-label={`Speed ${speedKnots.toFixed(1)} knots`}>
          <Arc cx={110} cy={110} radius={88} fromDegrees={-135} toDegrees={135} width={7} tone="muted" faint />
          <Arc cx={110} cy={110} radius={88} fromDegrees={-30} toDegrees={-30 - 55 * pitchFraction} width={7} tone="success" />
          <Arc cx={110} cy={110} radius={88} fromDegrees={-135} toDegrees={-135 + 48 * demand} width={7} tone="warn" />
          <Arc cx={110} cy={110} radius={88} fromDegrees={25} toDegrees={25 + 104 * demand} width={7} tone="accent" />
          <Arc cx={110} cy={110} radius={58} fromDegrees={158} toDegrees={202} width={2} tone="muted" dashed />
          <line
            className="rudder-needle"
            x1={polarPoint(110, 110, 34, 180 + rudderDegrees).x}
            y1={polarPoint(110, 110, 34, 180 + rudderDegrees).y}
            x2={polarPoint(110, 110, 60, 180 + rudderDegrees).x}
            y2={polarPoint(110, 110, 60, 180 + rudderDegrees).y}
          />
        </svg>

        <div className="propulsion-center">
          <strong>{speedKnots.toFixed(1)}</strong>
          <span>Speed KN</span>
          <div className="propulsion-split">
            <em>{Math.round(demand * 48 + 12)}%</em>
            <span aria-hidden="true">✺</span>
            <em>{Math.round(demand * 53 + 10)}%</em>
          </div>
          <span className="propulsion-rudder">Rudder {Math.round(rudderDegrees)}°</span>
        </div>

        <div className="propulsion-corner is-left">
          <Readout label="RPM" value={rpm} tone="warn" />
        </div>
        <div className="propulsion-corner is-right">
          <Readout label="Power" value={`${powerPercent}%`} tone="accent" align="end" />
        </div>
        <div className="propulsion-corner is-pitch">
          <Readout label="Pitch" value={`${pitchDegrees}°`} tone="success" />
        </div>
      </div>

      <div className="thrusters">
        <div className="thruster-pair">
          <MeterBar label="Port" value={portPercent} tone="accent" trailing={`${portPercent}%`} />
          <MeterBar label="Stbd" value={starboardPercent} tone="accent" trailing={`${starboardPercent}%`} />
        </div>
        <span className="thruster-label">Bow thrusters</span>
      </div>

      <div className="helm-controls" data-enabled={manual ? "true" : "false"}>
        <label>
          <span>Throttle</span>
          <input
            type="range"
            min={0}
            max={maximumSpeedKnots}
            step={0.5}
            value={speedKnots}
            disabled={!manual}
            onChange={(event) => onThrottle(Number(event.target.value))}
          />
          <em>{speedKnots.toFixed(1)} kn</em>
        </label>
        <label>
          <span>Rudder</span>
          <input
            type="range"
            min={-35}
            max={35}
            step={1}
            value={rudderDegrees}
            disabled={!manual}
            onChange={(event) => onRudder(Number(event.target.value))}
          />
          <em>{Math.round(rudderDegrees)}°</em>
        </label>
      </div>
    </section>
  );
}
