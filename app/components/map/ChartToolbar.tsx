"use client";

import { useEffect } from "react";
import type { FollowMode } from "../../core/followTarget.ts";
import { MISSION_PATTERNS, type MissionPattern } from "../../core/missionPlanner.ts";
import type { ChartTool } from "../../store/commandSlice.ts";
import PatternGlyph from "../outline/PatternGlyph";
import "./chartToolbar.css";

interface ChartToolbarProps {
  tool: ChartTool;
  onToolChange: (tool: ChartTool) => void;
  selectedCount: number;
  /** The contact an order would be pointed at, when one has been clicked. */
  targetName: string | null;
  onRoute: (pattern: MissionPattern) => void;
  onFollow: (mode: FollowMode) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  /** Whether the guided demo panel is on the chart. */
  demoOpen: boolean;
  /** "3/5" while a scenario is part-run, null at the brief. */
  demoStep: string | null;
  onDemoToggle: () => void;
  /** Each panel is on the screen, or it is not. They collapse independently. */
}

interface ToolSpec {
  id: ChartTool;
  label: string;
  key: string;
  hint: string;
  glyph: React.ReactNode;
}

const TOOLS: readonly ToolSpec[] = [
  {
    id: "SELECT",
    label: "Select",
    key: "v",
    hint: "",
    glyph: <path d="M5 3 L5 17 L9 13 L12 19 L14 18 L11 12 L16 12 Z" />,
  },
  {
    id: "OBJECTIVE",
    label: "Objective",
    key: "o",
    hint: "Click the chart to drop the objective missions are planned around",
    glyph: (
      <>
        <circle cx="11" cy="11" r="5.5" />
        <path d="M11 1 L11 4.5 M11 17.5 L11 21 M1 11 L4.5 11 M17.5 11 L21 11" />
      </>
    ),
  },
  {
    id: "PERIMETER",
    label: "Perimeter",
    key: "p",
    hint: "Click the chart to raise a perimeter, then drag its rim to resize",
    glyph: (
      <>
        <circle cx="11" cy="11" r="7.5" strokeDasharray="3 2.5" />
        <circle cx="11" cy="11" r="1.5" />
      </>
    ),
  },
  {
    id: "SURVEY",
    label: "Survey",
    key: "g",
    hint: "Click squares to mark the water to be searched; click again to drop one",
    glyph: (
      <>
        <rect x="2.5" y="2.5" width="17" height="17" rx="1.5" />
        <path d="M8.3 2.5 L8.3 19.5 M13.7 2.5 L13.7 19.5 M2.5 8.3 L19.5 8.3 M2.5 13.7 L19.5 13.7" />
      </>
    ),
  },
];

/**
 * The chart's own controls, in the shape a drawing tool uses: an icon per tool
 * with its name and key on hover, and an order bar that appears beside them the
 * moment something is selected. Giving an order never means leaving the chart.
 */
export default function ChartToolbar({
  tool,
  onToolChange,
  selectedCount,
  targetName,
  onRoute,
  onFollow,
  onSelectAll,
  onClearSelection,
  demoOpen,
  demoStep,
  onDemoToggle,
}: ChartToolbarProps) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      const typing = target instanceof HTMLElement
        && (target.isContentEditable
          || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (typing) return;

      if (event.key === "Escape") {
        onToolChange("SELECT");
        return;
      }

      const picked = TOOLS.find((candidate) => candidate.key === event.key.toLowerCase());
      if (picked) onToolChange(picked.id);
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onToolChange]);

  // ONE RAIL
  //
  // Tools and orders used to be two clusters: a rail at the top and a bar that
  // chased the selection centroid. The bar was centred on the selection and
  // then pulled back half its own width, so a selection near the left edge put
  // it under the fleet panel however hard the clamp tried. Orders live in the
  // rail now — one surface, in the middle column no panel covers, holding still
  // while the fleet moves underneath it.
  return (
    <div className="chart-tools">
      <div className="tool-rail">
        <div className="tool-group" role="group" aria-label="Chart tool">
          {TOOLS.map((spec) => (
            <button
              className={`tool-button${tool === spec.id ? " is-active" : ""}`}
              key={spec.id}
              type="button"
              onClick={() => onToolChange(spec.id)}
              aria-pressed={tool === spec.id}
              aria-label={spec.label}
              data-tip={spec.label}
              data-key={spec.key.toUpperCase()}
            >
              <svg viewBox="0 0 22 22" aria-hidden="true">{spec.glyph}</svg>
            </button>
          ))}

          <span className="tool-divider" aria-hidden="true" />

          <button
            className="tool-button"
            type="button"
            onClick={onSelectAll}
            aria-label="Select the whole fleet"
            data-tip="Select all"
          >
            <svg viewBox="0 0 22 22" aria-hidden="true">
              <rect x="2.5" y="2.5" width="17" height="17" rx="2" strokeDasharray="3 2.5" />
              <circle cx="8" cy="8" r="1.6" />
              <circle cx="14" cy="14" r="1.6" />
            </svg>
          </button>

          {/* The guided scenario is a panel the operator opens, not a mode the
              console is stuck in, so its switch sits with the other chart
              toggles and reports where a part-run script left off. */}
          <button
            className={`tool-button${demoOpen ? " is-active" : ""}`}
            type="button"
            onClick={onDemoToggle}
            aria-pressed={demoOpen}
            aria-label={demoOpen ? "Close the guided demo" : "Open the guided demo"}
            data-tip="Guided demo"
            data-note={demoStep
              ? `Five-step harbor patrol script · step ${demoStep}`
              : "Five-step harbor patrol script over the live fleet"}
          >
            <svg viewBox="0 0 22 22" aria-hidden="true">
              <path d="M6 3 L6 19" />
              <path d="M6 4.5 L16.5 4.5 L14 8.5 L16.5 12.5 L6 12.5" />
            </svg>
          </button>
        </div>

        {selectedCount > 0 && (
          <div className="tool-group is-orders" role="group" aria-label="Order the selection">
            <span className="tool-divider" aria-hidden="true" />

            <span className="tool-count">
              <strong>{selectedCount}</strong>
              selected
            </span>

            {MISSION_PATTERNS.map((spec) => (
              <button
                className="tool-button"
                key={spec.pattern}
                type="button"
                onClick={() => onRoute(spec.pattern)}
                aria-label={`${spec.label}: ${spec.summary}`}
                data-tip={spec.label}
                data-note={spec.summary}
              >
                <PatternGlyph pattern={spec.pattern} />
              </button>
            ))}

            {targetName && (
              <>
                <span className="tool-divider" aria-hidden="true" />
                <span className="tool-target" title="Click another contact to re-point these orders">
                  {targetName}
                </span>
                <button
                  className="tool-button"
                  type="button"
                  onClick={() => onFollow("ESCORT")}
                  aria-label={`Escort ${targetName}`}
                  data-tip="Escort"
                  data-note="Screen the contact and run with it"
                >
                  <svg viewBox="0 0 22 22" aria-hidden="true">
                    <path d="M11 3 L11 19" opacity="0.5" />
                    <circle cx="6" cy="8" r="1.8" />
                    <circle cx="16" cy="8" r="1.8" />
                    <circle cx="6" cy="15" r="1.8" />
                    <circle cx="16" cy="15" r="1.8" />
                  </svg>
                </button>
                <button
                  className="tool-button"
                  type="button"
                  onClick={() => onFollow("MONITOR")}
                  aria-label={`Monitor ${targetName}`}
                  data-tip="Monitor"
                  data-note="Shadow the contact from a standoff ring"
                >
                  <svg viewBox="0 0 22 22" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" strokeDasharray="2.5 2.5" />
                    <circle cx="11" cy="11" r="2" />
                  </svg>
                </button>
              </>
            )}

            <button
              className="tool-button"
              type="button"
              onClick={onClearSelection}
              aria-label="Clear the selection"
              data-tip="Clear"
            >
              <svg viewBox="0 0 22 22" aria-hidden="true">
                <path d="M6 6 L16 16 M16 6 L6 16" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
