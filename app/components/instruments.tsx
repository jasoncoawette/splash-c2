"use client";

import type { ReactNode } from "react";

export type InstrumentTone = "accent" | "success" | "warn" | "muted";

/**
 * Three primitives earn their place here because the console draws each of them
 * in at least three places: arcs in the propulsion ring and the tilt gauge,
 * bars in the thrusters, energy and mission progress, and the label/value pair
 * everywhere a number is reported. Anything drawn once stays in its own panel.
 */

/** Dial space: zero points up and degrees run clockwise, like a compass. */
export function polarPoint(
  cx: number,
  cy: number,
  radius: number,
  degrees: number,
) {
  const radians = ((degrees - 90) * Math.PI) / 180;

  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

export function arcPath(
  cx: number,
  cy: number,
  radius: number,
  fromDegrees: number,
  toDegrees: number,
): string {
  const { x: startX, y: startY } = polarPoint(cx, cy, radius, fromDegrees);
  const { x: endX, y: endY } = polarPoint(cx, cy, radius, toDegrees);
  const largeArc = Math.abs(toDegrees - fromDegrees) > 180 ? 1 : 0;
  const sweep = toDegrees >= fromDegrees ? 1 : 0;

  return `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} ${sweep} ${endX} ${endY}`;
}

interface ArcProps {
  cx: number;
  cy: number;
  radius: number;
  fromDegrees: number;
  toDegrees: number;
  width?: number;
  tone?: InstrumentTone;
  dashed?: boolean;
  faint?: boolean;
}

export function Arc({
  cx,
  cy,
  radius,
  fromDegrees,
  toDegrees,
  width = 4,
  tone = "accent",
  dashed = false,
  faint = false,
}: ArcProps) {
  if (Math.abs(toDegrees - fromDegrees) < 0.01) return null;

  return (
    <path
      className={`arc tone-${tone}${faint ? " is-faint" : ""}`}
      d={arcPath(cx, cy, radius, fromDegrees, toDegrees)}
      strokeWidth={width}
      strokeDasharray={dashed ? "2 5" : undefined}
      strokeLinecap="round"
    />
  );
}

interface MeterBarProps {
  label?: string;
  value: number;
  max?: number;
  tone?: InstrumentTone;
  trailing?: ReactNode;
}

export function MeterBar({
  label,
  value,
  max = 100,
  tone = "accent",
  trailing,
}: MeterBarProps) {
  const fraction = max === 0 ? 0 : Math.min(Math.max(value / max, 0), 1);

  return (
    <div className="meter">
      {(label || trailing) && (
        <div className="meter-head">
          <span>{label}</span>
          <span>{trailing}</span>
        </div>
      )}
      <div className="meter-track">
        <span className={`meter-fill tone-${tone}`} style={{ width: `${fraction * 100}%` }} />
      </div>
    </div>
  );
}

interface ReadoutProps {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: InstrumentTone;
  align?: "start" | "center" | "end";
}

export function Readout({ label, value, unit, tone, align = "start" }: ReadoutProps) {
  return (
    <div className={`readout is-${align}`}>
      <strong className={tone ? `tone-${tone}` : undefined}>
        {value}
        {unit && <em>{unit}</em>}
      </strong>
      <span>{label}</span>
    </div>
  );
}
