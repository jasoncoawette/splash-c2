"use client";

import { useEffect, type ReactNode } from "react";
import "./consoleShell.css";

interface ConsoleShellProps {
  /** The vessel list, down the left. */
  fleet: ReactNode;
  fleetOpen: boolean;
  /**
   * What the fleet is doing, under the vessel list on the same edge.
   *
   * It has no toggle of its own and travels with the fleet panel: the console
   * keeps one control per column, and collapsing the left column has to leave
   * the chart clear rather than leaving a second window on it.
   */
  activity?: ReactNode;
  /** The selected vessel, down the right. Null when nothing is selected. */
  detail: ReactNode | null;
  detailOpen: boolean;
  onFleetToggle: (open: boolean) => void;
  onDetailToggle: (open: boolean) => void;
  /** The chart the panels sit over. */
  children: ReactNode;
}

/** A chevron that points the way the panel will travel. */
function Chevron() {
  return (
    <svg viewBox="0 0 12 22" aria-hidden="true">
      <path d="M8 4 L3.5 11 L8 18" />
    </svg>
  );
}

/**
 * Two panels over one chart: the fleet on the left, the selected vessel on the
 * right, each collapsing on its own. They float over the chart rather than
 * taking width from it, so the water an operator is working on never moves when
 * a panel opens.
 */
export default function ConsoleShell({
  fleet,
  fleetOpen,
  activity,
  detail,
  detailOpen,
  onFleetToggle,
  onDetailToggle,
  children,
}: ConsoleShellProps) {
  const detailAvailable = detail !== null;
  const detailShown = detailAvailable && detailOpen;

  // The handles carry their own shortcuts: the component that owns the panel
  // owns the way to open it, rather than the chart toolbar reaching across.
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      if (target instanceof HTMLElement
        && (target.isContentEditable
          || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;

      const key = event.key.toLowerCase();
      if (key === "b") onFleetToggle(!fleetOpen);
      else if (key === "d" && detailAvailable) onDetailToggle(!detailOpen);
      else return;

      event.preventDefault();
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [fleetOpen, detailOpen, detailAvailable, onFleetToggle, onDetailToggle]);

  return (
    <section
      className="console-stage"
      data-fleet-open={fleetOpen}
      data-detail-open={detailShown}
      data-activity-open={fleetOpen && activity !== undefined}
    >
      <div className="console-chart">{children}</div>

      {fleetOpen && (
        <aside className="shell-panel is-fleet" aria-label="Fleet">
          {fleet}
        </aside>
      )}

      {fleetOpen && activity !== undefined && (
        <aside className="shell-panel is-activity" aria-label="Fleet activity">
          {activity}
        </aside>
      )}

      {detailShown && (
        <aside className="shell-panel is-detail" aria-label="Selected vessel">
          {detail}
        </aside>
      )}

      {/* Each handle rides the edge of its own panel, so the control that
          closes a panel is always against the panel it closes. */}
      <button
        className="console-handle is-fleet"
        type="button"
        onClick={() => onFleetToggle(!fleetOpen)}
        aria-pressed={fleetOpen}
        aria-label={fleetOpen ? "Collapse the fleet panel" : "Open the fleet panel"}
        title={`${fleetOpen ? "Collapse" : "Open"} fleet · B`}
      >
        <Chevron />
      </button>

      {detailAvailable && (
        <button
          className="console-handle is-detail"
          type="button"
          onClick={() => onDetailToggle(!detailOpen)}
          aria-pressed={detailOpen}
          aria-label={detailOpen ? "Collapse the vessel panel" : "Open the vessel panel"}
          title={`${detailOpen ? "Collapse" : "Open"} vessel · D`}
        >
          <Chevron />
        </button>
      )}
    </section>
  );
}
