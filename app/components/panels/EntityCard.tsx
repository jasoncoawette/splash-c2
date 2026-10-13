"use client";

import type { MouseEvent, ReactNode } from "react";
import CapabilityIcon from "./CapabilityIcon";
import { CAPABILITY_LABEL, type CapabilityId } from "./capabilities.ts";

export type EntityTone = "FRIENDLY" | "TRAFFIC" | "ZONE" | "ALERT";

export interface EntityAction {
  id: string;
  label: string;
  glyph: ReactNode;
  onSelect: () => void;
}

interface EntityCardProps {
  /** The platform or shape itself, drawn small. */
  glyph: ReactNode;
  name: string;
  subtitle: string;
  /** Affiliation marker: one letter in a diamond, as a chart symbol would be. */
  badge: { label: string; tone: EntityTone };
  capabilities?: readonly CapabilityId[];
  /** Things you can do to this entity, shown beside its capabilities. */
  actions?: readonly EntityAction[];
  /** The hull number, MMSI or ring number, set small and last. */
  reference: string;
  selected?: boolean;
  grouped?: boolean;
  alert?: boolean;
  onSelect?: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * One row for anything the operator can point at: a vessel, a perimeter, a
 * contact. Same shape every time — mark, name, affiliation, what it carries,
 * what it is called — so the eye learns one layout and reads the rest for free.
 *
 * The row is a div rather than a button because it holds its own buttons, and a
 * button inside a button is not a thing. Keyboard access is kept by hand.
 */
export default function EntityCard({
  glyph,
  name,
  subtitle,
  badge,
  capabilities = [],
  actions = [],
  reference,
  selected = false,
  grouped = false,
  alert = false,
  onSelect,
}: EntityCardProps) {
  const interactive = Boolean(onSelect);

  return (
    <div
      className={`entity-card${selected ? " is-selected" : ""}${grouped ? " is-grouped" : ""}${alert ? " is-alert" : ""}`}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? selected : undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (!onSelect) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect(event as unknown as MouseEvent<HTMLElement>);
      }}
    >
      <span className="entity-glyph" aria-hidden="true">{glyph}</span>

      <span className="entity-identity">
        <strong>{name}</strong>
        <span>{subtitle}</span>
      </span>

      {/* The letter is carried as data so the diamond can be rotated without
          taking its label round with it. */}
      <span
        className={`entity-badge is-${badge.tone.toLowerCase()}`}
        data-label={badge.label}
        aria-hidden="true"
      />

      <span className="entity-footer">
        <span className="entity-capabilities">
          {capabilities.map((id) => (
            <span className="entity-capability" key={id} title={CAPABILITY_LABEL[id]}>
              <CapabilityIcon id={id} />
            </span>
          ))}

          {actions.map((action) => (
            <button
              className="entity-action"
              key={action.id}
              type="button"
              title={action.label}
              aria-label={action.label}
              onClick={(event) => {
                event.stopPropagation();
                action.onSelect();
              }}
            >
              {action.glyph}
            </button>
          ))}
        </span>

        <span className="entity-reference">{reference}</span>
      </span>
    </div>
  );
}
