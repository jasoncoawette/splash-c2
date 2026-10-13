import type { MissionPattern } from "../../core/missionPlanner.ts";

/**
 * One drawing per mission pattern, at icon size. The shapes say what the boats
 * will do: a ring around a point, lanes across a box, a run to a point, a line
 * abreast of a track, a held station.
 */
const GLYPHS: Record<MissionPattern, React.ReactNode> = {
  PERIMETER: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="1.4" />
    </>
  ),
  SWEEP: (
    <>
      <path d="M5 4 L5 20 M12 4 L12 20 M19 4 L19 20" />
      <path d="M3 4 L21 4" opacity="0.5" />
    </>
  ),
  TRANSIT: (
    <>
      <path d="M5 19 L19 5" />
      <path d="M13 5 L19 5 L19 11" />
    </>
  ),
  ESCORT: (
    <>
      <path d="M4 12 L20 12" opacity="0.5" />
      <circle cx="8" cy="7" r="1.8" />
      <circle cx="16" cy="7" r="1.8" />
      <circle cx="8" cy="17" r="1.8" />
      <circle cx="16" cy="17" r="1.8" />
    </>
  ),
  STATION: (
    <>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2 L12 6 M12 18 L12 22 M2 12 L6 12 M18 12 L22 12" />
    </>
  ),
};

export default function PatternGlyph({ pattern }: { pattern: MissionPattern }) {
  return (
    <svg className="pattern-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {GLYPHS[pattern]}
    </svg>
  );
}
