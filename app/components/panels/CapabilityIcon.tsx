import type { CapabilityId } from "./capabilities.ts";

/**
 * One 16px line glyph per capability. Drawn rather than lettered: a row of
 * shapes is scannable at a glance, which is the whole point of putting them on
 * the card instead of in the detail panel.
 */
const GLYPHS: Record<CapabilityId, React.ReactNode> = {
  EO: (
    <>
      <circle cx="8" cy="8" r="4.2" />
      <circle cx="8" cy="8" r="1.4" />
      <path d="M8 1.6 L8 3.4 M8 12.6 L8 14.4" />
    </>
  ),
  COMMS: (
    <>
      <path d="M8 14 L8 5" />
      <path d="M5.2 8.4 A 4 4 0 0 1 10.8 8.4" />
      <path d="M3 10.6 A 7.4 7.4 0 0 1 13 10.6" />
      <circle cx="8" cy="3.6" r="1.1" />
    </>
  ),
  DECK: (
    <>
      <rect x="2.2" y="4.4" width="11.6" height="7.2" rx="1.4" />
      <path d="M2.2 8 L13.8 8" />
    </>
  ),
  DRIVE: (
    <>
      <circle cx="8" cy="8" r="1.5" />
      <path d="M8 6.5 C 5 3.5 3.2 4.6 4.4 7 M8 9.5 C 11 12.5 12.8 11.4 11.6 9" />
      <path d="M9.5 8 C 12.5 5 11.4 3.2 9 4.4 M6.5 8 C 3.5 11 4.6 12.8 7 11.6" />
    </>
  ),
  HELM: (
    <>
      <circle cx="8" cy="8" r="5" />
      <path d="M8 3 L8 13 M3 8 L13 8" />
    </>
  ),
  TASKED: (
    <>
      <path d="M2.4 12.4 C 5 12.4 5.4 3.6 8 3.6 C 10.6 3.6 11 12.4 13.6 12.4" />
      <circle cx="2.4" cy="12.4" r="1.2" />
      <circle cx="13.6" cy="12.4" r="1.2" />
    </>
  ),
};

export default function CapabilityIcon({ id }: { id: CapabilityId }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {GLYPHS[id]}
    </svg>
  );
}
