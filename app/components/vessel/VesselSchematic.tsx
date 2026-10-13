"use client";

import type { BoatDefinition, BoatState } from "../../core/types";
import { buildProfile } from "./profile.ts";
import { specFor } from "./spec.ts";
import {
  hasEstimate,
  subsystemsOf,
  type Subsystem,
  type SubsystemContext,
  type SubsystemId,
} from "./subsystems.ts";
import "./vesselSchematic.css";

// THE HULL, WITH A WINDOW ON EVERY PART
//
// The same side elevation the platform drawings use, generated from the same
// spec the 3D hull is built from, with one pin per fitted part. A pin toggles
// that part's telemetry window; any number can be open at once.
//
// The pins are HTML buttons over the drawing rather than shapes inside it, so
// each one is a real control with a focus ring, a title and a hit area, and
// their positions come from the part's anchor in model metres — a pin cannot
// drift away from the thing it points at, because both are generated from the
// same geometry.
//
// Windows stack under the drawing rather than floating over it. Pinned beside
// their part they overlapped each other at panel width, and a readout you have
// to drag out of the way of another readout is worse than a list.

interface VesselSchematicProps {
  definition: BoatDefinition;
  state: BoatState;
  context?: SubsystemContext;
  /** Which windows are open, from the store. */
  openIds: readonly string[];
  onToggle: (id: SubsystemId) => void;
  onSetAll: (ids: readonly SubsystemId[]) => void;
}

/** Model metres to a percentage across the drawing's own box. */
function pinStyle(
  part: Subsystem,
  frame: { minY: number; maxY: number; minZ: number; maxZ: number },
) {
  const width = frame.maxY - frame.minY;
  const height = frame.maxZ - frame.minZ;

  return {
    left: `${((part.anchor.y - frame.minY) / width) * 100}%`,
    top: `${((frame.maxZ - part.anchor.z) / height) * 100}%`,
  };
}

export default function VesselSchematic({
  definition,
  state,
  context,
  openIds,
  onToggle,
  onSetAll,
}: VesselSchematicProps) {
  const spec = specFor(definition.type);
  const drawing = buildProfile(spec);
  const parts = subsystemsOf(definition, state, context);
  const open = new Set(openIds);

  const { minY, maxY, minZ, maxZ } = drawing.bounds;
  const frame = { minY, maxY, minZ, maxZ };

  // Which paths to light up: every part id owned by an open window.
  const live = new Set(
    parts.filter((part) => open.has(part.id)).flatMap((part) => part.partIds),
  );

  const openCount = parts.filter((part) => open.has(part.id)).length;
  const faults = parts.filter(
    (part) => part.status === "OFFLINE" || part.status === "DEGRADED",
  );

  return (
    <section className="vsys" aria-label={`${definition.name} systems`}>
      <header className="vsys-head">
        <h2>Systems</h2>
        <p>
          <span>{parts.length} fitted</span>
          <span>{openCount} open</span>
          {faults.length > 0 && <span className="is-fault">{faults.length} to watch</span>}
        </p>
        <button
          type="button"
          onClick={() => onSetAll(
            openCount === parts.length ? [] : parts.map((part) => part.id),
          )}
        >
          {openCount === parts.length ? "Close all" : "Open all"}
        </button>
      </header>

      <div className="vsys-stage">
        <svg
          className="vsys-drawing"
          viewBox={`${minY} ${-maxZ} ${maxY - minY} ${maxZ - minZ}`}
          role="img"
          aria-label={`${definition.type} side elevation, ${spec.lengthM} metres overall`}
        >
          {/* +z is up in the model and down in SVG, so the group flips. */}
          <g transform="scale(1 -1)">
            {drawing.parts.map((part) => (
              <path
                className={`vsys-${part.weight}${live.has(part.id) ? " is-live" : ""}`}
                d={part.d}
                key={part.id}
              />
            ))}
          </g>
        </svg>

        {parts.map((part) => (
          <button
            className={`vsys-pin is-${part.status.toLowerCase()}${open.has(part.id) ? " is-open" : ""}`}
            key={part.id}
            type="button"
            style={pinStyle(part, frame)}
            aria-pressed={open.has(part.id)}
            aria-label={`${open.has(part.id) ? "Close" : "Open"} ${part.label} telemetry`}
            title={`${part.label} · ${part.status.toLowerCase()}`}
            onClick={() => onToggle(part.id)}
          >
            <span aria-hidden="true" />
          </button>
        ))}
      </div>

      {openCount === 0 ? (
        <p className="vsys-empty">Tap a pin on the hull to open that part&apos;s telemetry.</p>
      ) : (
        <div className="vsys-windows">
          {parts.filter((part) => open.has(part.id)).map((part) => (
            <article className={`vsys-window is-${part.status.toLowerCase()}`} key={part.id}>
              <header>
                <h3>{part.label}</h3>
                <span className="vsys-status">{part.status}</span>
                <button
                  type="button"
                  aria-label={`Close ${part.label} telemetry`}
                  onClick={() => onToggle(part.id)}
                >
                  ×
                </button>
              </header>

              <p className="vsys-summary">{part.summary}</p>

              <div className="vsys-load" aria-hidden="true">
                <span style={{ width: `${Math.min(Math.max(part.load, 0), 1) * 100}%` }} />
              </div>

              <dl className="vsys-channels">
                {part.channels.map((channel) => (
                  <div key={channel.label}>
                    <dt>{channel.label}</dt>
                    <dd>
                      {channel.value}
                      {channel.estimated && <em title="Derived for the demo, not measured">est</em>}
                    </dd>
                  </div>
                ))}
              </dl>

              {/* The ledger rule: a made-up value must not look measured. */}
              {hasEstimate(part) && <p className="vsys-caveat">SIM EST · derived, not measured</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
