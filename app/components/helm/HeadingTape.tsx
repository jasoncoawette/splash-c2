"use client";

import type { Contact } from "./frame";

const WINDOW_DEGREES = 60;
const TICK_STEP = 2;

interface HeadingTapeProps {
  headingDegrees: number;
  /** Bearing the autopilot or the operator is steering to, when there is one. */
  courseDegrees: number | null;
  nearestContact: Contact | null;
}

/** The compass strip across the top of the console, read against the bow mark. */
export default function HeadingTape({
  headingDegrees,
  courseDegrees,
  nearestContact,
}: HeadingTapeProps) {
  const half = WINDOW_DEGREES / 2;
  const first = Math.ceil((headingDegrees - half) / TICK_STEP) * TICK_STEP;
  const ticks = [];

  for (let degrees = first; degrees <= headingDegrees + half; degrees += TICK_STEP) {
    const offset = ((degrees - headingDegrees) / WINDOW_DEGREES) * 100 + 50;
    const compass = ((degrees % 360) + 360) % 360;

    ticks.push(
      <span
        className={`tape-tick${compass % 10 === 0 ? " is-major" : ""}`}
        key={degrees}
        style={{ left: `${offset}%` }}
      >
        {compass % 10 === 0 && <em>{String(Math.round(compass)).padStart(3, "0")}</em>}
      </span>,
    );
  }

  const courseOffset =
    courseDegrees === null
      ? null
      : ((((courseDegrees - headingDegrees + 540) % 360) - 180) / WINDOW_DEGREES) * 100 + 50;
  const contactOffset =
    nearestContact && Math.abs(nearestContact.relativeDegrees) <= half
      ? (nearestContact.relativeDegrees / WINDOW_DEGREES) * 100 + 50
      : null;

  return (
    <div className="heading-tape">
      <div className="tape-track">{ticks}</div>

      {courseOffset !== null && courseOffset >= 0 && courseOffset <= 100 && (
        <span className="tape-bug" style={{ left: `${courseOffset}%` }} aria-hidden="true" />
      )}

      {contactOffset !== null && nearestContact && (
        <span className="tape-contact" style={{ left: `${contactOffset}%` }}>
          ONCOMING {Math.abs(Math.round(nearestContact.relativeDegrees))}°
        </span>
      )}

      <div className="tape-bow">
        <span className="tape-bow-mark" aria-hidden="true" />
        <span className="tape-bow-value">
          HEADING <strong>{String(Math.round(headingDegrees)).padStart(3, "0")}°</strong>
        </span>
      </div>
    </div>
  );
}
