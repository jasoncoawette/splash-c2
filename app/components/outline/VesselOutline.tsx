import "./outline.css";
import type { BoatType } from "../../core/types";
import {
  DECK_BOW_STATION,
  DECK_STERN_STATION,
  deckHalfBeam,
  demiWidth,
  hullSpacing,
  specFor,
  type VesselSpec,
} from "../vessel/spec.ts";

interface VesselOutlineProps {
  type: BoatType;
  className?: string;
}

const STEPS = 44;

/** Metres forward of amidships, as the drawing's y runs bow-up. */
function stationY(spec: VesselSpec, t: number): number {
  return -((t - 0.5) * spec.lengthM);
}

function path(points: readonly (readonly [number, number])[]): string {
  return `${points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(3)} ${y.toFixed(3)}`).join(" ")} Z`;
}

/**
 * One demi-hull in plan, outer edge forward and inner edge back, taken from the
 * same curves the Three.js hull is lofted from. `side` is +1 to starboard.
 */
function demiHull(spec: VesselSpec, side: 1 | -1): string {
  const offset = hullSpacing(spec) / 2;
  const halfAt = (t: number) => (spec.demiBeamM / 2) * demiWidth(t);
  const outer: [number, number][] = [];
  const inner: [number, number][] = [];

  for (let step = 0; step <= STEPS; step += 1) {
    const t = step / STEPS;
    const y = stationY(spec, t);
    outer.push([side * (offset + halfAt(t)), y]);
    inner.push([side * (offset - halfAt(t)), y]);
  }

  return path([...outer, ...inner.reverse()]);
}

/** The deck bridging the hulls. It stops short of the stems, which is what
 *  leaves the two bows standing proud of it. */
function deck(spec: VesselSpec): string {
  const half = deckHalfBeam(spec);
  const bow = stationY(spec, DECK_BOW_STATION);
  const stern = stationY(spec, DECK_STERN_STATION);
  const shoulder = stationY(spec, DECK_BOW_STATION - 0.17);

  return path([
    [-half, stern],
    [-half, shoulder],
    [0, bow],
    [half, shoulder],
    [half, stern],
  ]);
}

/**
 * A plan view of each class, generated from the vessel spec rather than drawn,
 * so the button cannot come to disagree with the hull it creates. The family is
 * one wave-piercing catamaran in two sizes; the Typhoon's sensor tower is the
 * only thing that tells them apart from above.
 */
export default function VesselOutline({ type, className }: VesselOutlineProps) {
  const spec = specFor(type);
  const halfWidth = (spec.beamM / 2) * 1.18;
  const halfLength = (spec.lengthM / 2) * 1.04;
  const tower = spec.tower;

  return (
    <svg
      className={className ? `vessel-outline ${className}` : "vessel-outline"}
      viewBox={`${-halfWidth} ${-halfLength} ${halfWidth * 2} ${halfLength * 2}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <path className="vessel-outline-deck" d={deck(spec)} />
      <path className="vessel-outline-hull" d={demiHull(spec, -1)} />
      <path className="vessel-outline-hull" d={demiHull(spec, 1)} />

      {tower && (
        <g className="vessel-outline-tower">
          <circle cx={0} cy={stationY(spec, tower.station)} r={tower.podRadiusM} />
          <path
            d={`M ${-tower.armM} ${stationY(spec, tower.station)} L ${tower.armM} ${stationY(spec, tower.station)}`}
          />
        </g>
      )}
    </svg>
  );
}
