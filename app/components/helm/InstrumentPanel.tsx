"use client";

import { Arc, MeterBar, polarPoint, Readout } from "../instruments";

interface InstrumentPanelProps {
  boatId: string;
  tiltDegrees: number;
  energyPercent: number;
  speedKnots: number;
}

/**
 * Demo assumption: the energy history is a fixed profile derived from the boat
 * ID so the panel is stable between renders, not a measured draw.
 */
function energyHistory(boatId: string): number[] {
  let seed = 0;

  for (const character of boatId) {
    seed = (seed * 31 + character.charCodeAt(0)) % 9973;
  }

  return Array.from({ length: 34 }, (_, index) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return 18 + ((seed >> 8) % 82) * (index % 7 === 0 ? 0.4 : 1);
  });
}

export default function InstrumentPanel({
  boatId,
  tiltDegrees,
  energyPercent,
  speedKnots,
}: InstrumentPanelProps) {
  const history = energyHistory(boatId);
  const averageMwh = (history.reduce((total, bar) => total + bar, 0) / history.length) / 12;
  const usedMwh = 130.9 - energyPercent * 0.3;
  const clampedTilt = Math.max(Math.min(tiltDegrees, 20), -20);

  return (
    <section className="console-panel" aria-label="Instruments">
      <header className="console-panel-head">
        <h2>Instruments</h2>
        <span aria-hidden="true">▾</span>
      </header>

      <div className="tilt-gauge">
        <svg viewBox="0 0 220 120" role="img" aria-label={`Tilt ${clampedTilt.toFixed(1)} degrees`}>
          <Arc cx={110} cy={110} radius={88} fromDegrees={-80} toDegrees={80} width={2} tone="muted" faint />
          {Array.from({ length: 17 }, (_, index) => {
            const degrees = -80 + index * 10;
            const major = index % 4 === 0;
            const inner = polarPoint(110, 110, major ? 70 : 78, degrees);
            const outer = polarPoint(110, 110, 88, degrees);

            return (
              <line
                className={`tilt-tick${major ? " is-major" : ""}`}
                key={degrees}
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
              />
            );
          })}
          <g transform={`rotate(${clampedTilt} 110 92)`}>
            <line className="tilt-waterline" x1={22} y1={92} x2={198} y2={92} />
            <path className="tilt-hull" d="M88 76 L132 76 L126 100 Q110 108 94 100 Z" />
          </g>
        </svg>
        <span className="tilt-value">
          <strong>{clampedTilt.toFixed(1)}°</strong>
          <span>Tilt</span>
        </span>
      </div>

      <div className="energy-block">
        <span className="console-label">Energy cons</span>
        <div className="energy-bars" aria-hidden="true">
          {history.map((bar, index) => (
            <span key={index} style={{ height: `${Math.min(bar, 100)}%` }} />
          ))}
        </div>
        <div className="energy-figures">
          <Readout label="MWH avg" value={averageMwh.toFixed(1)} />
          <Readout label="MWH used" value={usedMwh.toFixed(1)} align="end" />
        </div>
      </div>

      <div className="energy-state">
        <MeterBar
          label="Battery"
          value={energyPercent}
          tone={energyPercent < 25 ? "warn" : "success"}
          trailing={`${Math.round(energyPercent)}%`}
        />
        <MeterBar label="Through water" value={speedKnots} max={60} trailing={`${speedKnots.toFixed(1)} kn`} />
      </div>
    </section>
  );
}
