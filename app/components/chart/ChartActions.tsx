"use client";

import { useEffect } from "react";

/**
 * WHAT CAN I DO WITH THIS?
 *
 * Clicking a thing on the chart answers that question where the thing is,
 * rather than sending the operator to a panel to find out. The overlay is
 * purely presentational: it is handed a list of actions and renders them, so
 * what a boat, a contact and an objective each offer is decided by the
 * container that knows the fleet, not here.
 */
export type ChartFocusKind = "BOAT" | "CONTACT" | "OBJECTIVE";

export interface ChartFocus {
  kind: ChartFocusKind;
  id: string;
  title: string;
  subtitle?: string;
  longitude: number;
  latitude: number;
}

export interface ChartAction {
  id: string;
  label: string;
  hint?: string;
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
  run: () => void;
}

interface ChartActionsProps {
  focus: ChartFocus;
  /** Screen position of the focused object, kept in step with the camera. */
  x: number;
  y: number;
  actions: readonly ChartAction[];
  onDismiss: () => void;
}

export default function ChartActions({
  focus,
  x,
  y,
  actions,
  onDismiss,
}: ChartActionsProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div
      className="chart-actions"
      style={{ left: `${x}px`, top: `${y}px` }}
      role="dialog"
      aria-label={`Actions for ${focus.title}`}
    >
      <header className="chart-actions-head">
        <div>
          <strong>{focus.title}</strong>
          {focus.subtitle && <span>{focus.subtitle}</span>}
        </div>
        <button
          className="chart-actions-close"
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ×
        </button>
      </header>

      <div className="chart-actions-list">
        {actions.map((action) => (
          <button
            className={`chart-action is-${action.tone ?? "default"}`}
            key={action.id}
            type="button"
            disabled={action.disabled}
            title={action.hint}
            onClick={() => {
              action.run();
              onDismiss();
            }}
          >
            <span>{action.label}</span>
            {action.hint && <em>{action.hint}</em>}
          </button>
        ))}
      </div>
    </div>
  );
}
