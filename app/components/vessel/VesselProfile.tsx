"use client";

import type { BoatType } from "../../core/types";
import {
  buildProfile,
  deckPlanOutline,
  demiPlanOutline,
  familyFrame,
} from "./profile.ts";
import { specFor, TEMPEST_SPEC } from "./spec.ts";

/** The plan band is sized for the widest class, so both sit on one baseline. */
const TEMPEST_BEAM_FOR_FRAME = TEMPEST_SPEC.beamM;

// SIDE ELEVATION AND PLAN
//
// A wireframe drawing of one class, generated from the same spec the Three.js
// hull is built from. If the hull changes, this changes with it; it cannot go
// stale, because there is nothing here to keep in step by hand.

export default function VesselProfile({ type }: { type: BoatType }) {
  const spec = specFor(type);
  const drawing = buildProfile(spec);
  // Both classes are drawn in one frame, so a Tempest is visibly the larger
  // boat instead of being scaled up to fill its own card.
  const { minY, maxY, minZ, maxZ } = familyFrame();
  const { lengthM, beamM, draftM, deckM, heightM } = drawing.dimensions;

  const planHeight = TEMPEST_BEAM_FOR_FRAME * 1.2;
  const width = maxY - minY;
  const height = maxZ - minZ + planHeight + 0.4;

  return (
    <figure className="vp-sheet">
      <figcaption className="vp-head">
        <h2 className="vp-name">{type}</h2>
        <span className="vp-role">
          {spec.tower ? "Sensor tower · catamaran" : "Flat deck · catamaran"}
        </span>
      </figcaption>

      <svg
        className="vp-drawing"
        viewBox={`${minY} ${-maxZ} ${width} ${height}`}
        role="img"
        aria-label={`${type} side elevation and plan, ${lengthM} metres overall`}
      >
        {/* Elevation: +z is up in the model, down in SVG, so the group flips. */}
        <g transform="scale(1 -1)">
          {drawing.parts.map((part) => (
            <path className={`vp-${part.weight}`} d={part.d} key={part.id} />
          ))}
        </g>

        {/* Plan view underneath, on the same length scale. */}
        <g transform={`translate(0 ${(-minZ + 0.3 + planHeight / 2).toFixed(3)})`}>
          {/* Both demi-hulls, each closed on its own outboard and inboard
              edges, so the tunnel between them is drawn rather than implied. */}
          <path className="vp-plan" d={demiPlanOutline(spec)} />
          <path className="vp-plan" d={demiPlanOutline(spec)} transform="scale(1 -1)" />
          <path className="vp-detail" d={deckPlanOutline(spec)} />
          <path
            className="vp-construction"
            d={`M${(minY + 0.1).toFixed(3)} 0 L${(maxY - 0.1).toFixed(3)} 0`}
          />
        </g>
      </svg>

      <dl className="vp-table">
        <div>
          <dt>Length</dt>
          <dd>{lengthM.toFixed(2)} m</dd>
        </div>
        <div>
          <dt>Beam</dt>
          <dd>{beamM.toFixed(2)} m</dd>
        </div>
        <div>
          <dt>Draft</dt>
          <dd>{draftM.toFixed(2)} m</dd>
        </div>
        <div>
          <dt>Deck</dt>
          <dd>{deckM.toFixed(2)} m</dd>
        </div>
        <div>
          <dt>Air draft</dt>
          <dd>{heightM.toFixed(2)} m</dd>
        </div>
      </dl>
    </figure>
  );
}
