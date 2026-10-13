"use client";

import { useAppDispatch, useAppSelector } from "../../store/hooks.ts";
import { boatsSelected } from "../../store/commandSlice.ts";
import { perimeterSelected } from "../../store/perimeterSlice.ts";
import { cellsCleared } from "../../store/surveySlice.ts";
import { createBoat, exploreSurvey, takeOver } from "../../store/orders.ts";
import {
  selectBoatViews,
  selectSelectedBoatId,
  selectSelectedIds,
} from "../../store/selectors.ts";
import { mergeSelection } from "../map";
import VesselOutline from "../outline/VesselOutline";
import EntityCard from "./EntityCard";
import { capabilitiesOf } from "./capabilities.ts";
import "./fleetPanel.css";

// THE FLEET PANEL
//
// Everything the operator OWNS, in one list and one card shape: vessels first,
// then the perimeters they are screening, then the survey squares. A card never
// changes layout between kinds, so the eye learns it once.
//
// Live traffic is deliberately absent. It is not the operator's to command, it
// arrives three hundred contacts at a time, and a list of it buried the three
// hulls this console exists to fly. Traffic is picked on the chart, where its
// position is the thing that matters.
//
// A container, not a leaf: it reads the store directly rather than taking
// twenty props through the dashboard.

/**
 * One letter per kind, and no two kinds share one. Tempest was "P" until a
 * perimeter sat next to it wearing the same letter in a different colour.
 */
const BADGE = {
  TYPHOON: "T",
  TEMPEST: "M",
} as const;

function CameraGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.8" y="4.4" width="12.4" height="8.2" rx="1.6" />
      <circle cx="8" cy="8.5" r="2.4" />
      <path d="M5.4 4.4 L6.4 2.6 L9.6 2.6 L10.6 4.4" />
    </svg>
  );
}

function PerimeterGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" strokeDasharray="3 2.6" />
      <circle cx="12" cy="12" r="1.6" />
    </svg>
  );
}

export default function FleetPanel() {
  const dispatch = useAppDispatch();
  const boats = useAppSelector(selectBoatViews);
  const selectedBoatId = useAppSelector(selectSelectedBoatId);
  const selectedIds = useAppSelector(selectSelectedIds);
  const perimeters = useAppSelector((state) => state.perimeters.perimeters);
  const activePerimeterId = useAppSelector((state) => state.perimeters.activeId);
  const surveyCells = useAppSelector((state) => state.survey.cells);
  const surveySizeNm = useAppSelector((state) => state.survey.cellSizeNm);
  const links = useAppSelector((state) => state.scenario.links);
  const tasked = boats.filter(({ state }) => state.missionId !== null).length;

  return (
    <div className="fleet-panel" >
      <header className="fleet-panel-head">
        <span className="fleet-panel-mark" aria-hidden="true">
          <VesselOutline type="TEMPEST" />
        </span>
        <div>
          <h1>Fleet</h1>
          <p>
            <span>{boats.length} vessels</span>
            <span>{tasked} tasked</span>
          </p>
        </div>
      </header>

      <div className="fleet-panel-scroll">
        <ul className="entity-list">
          {boats.map(({ definition, state }) => {
            const linkLost = links[state.id] === "LOST";

            return <li key={state.id}>
              <EntityCard
                glyph={<VesselOutline type={definition.type} />}
                name={definition.name}
                subtitle={linkLost
                  ? `${definition.type.charAt(0)}${definition.type.slice(1).toLowerCase()} · LINK LOST · ${state.mode.toLowerCase()}`
                  : `${definition.type.charAt(0)}${definition.type.slice(1).toLowerCase()} · ${state.mode.toLowerCase()}`}
                badge={{ label: linkLost ? "!" : BADGE[definition.type], tone: linkLost ? "ALERT" : "FRIENDLY" }}
                capabilities={capabilitiesOf(definition.type, state)}
                actions={[{
                  id: "camera",
                  label: `Open ${definition.name}'s front view`,
                  glyph: <CameraGlyph />,
                  onSelect: () => dispatch(takeOver(state.id)),
                }]}
                reference={state.id.toUpperCase()}
                selected={selectedBoatId === state.id}
                grouped={selectedIds.includes(state.id)}
                alert={linkLost}
                onSelect={(event) => dispatch(boatsSelected(mergeSelection(
                  selectedIds,
                  state.id,
                  event.shiftKey || event.metaKey || event.ctrlKey,
                )))}
              />
            </li>
          })}
        </ul>

        {perimeters.length > 0 && (
          <>
            <p className="entity-group">Perimeters</p>
            <ul className="entity-list">
              {perimeters.map((perimeter) => (
                <li key={perimeter.id}>
                  <EntityCard
                    glyph={<PerimeterGlyph />}
                    name={perimeter.name}
                    subtitle={`${perimeter.radiusNm.toFixed(1)} NM · ${perimeter.boatIds.length} screening`}
                    badge={{ label: "Z", tone: "ZONE" }}
                    reference={perimeter.id.toUpperCase()}
                    selected={activePerimeterId === perimeter.id}
                    onSelect={() => dispatch(perimeterSelected(perimeter.id))}
                  />
                </li>
              ))}
            </ul>
          </>
        )}

        {surveyCells.length > 0 && (
          <>
            <p className="entity-group">Survey</p>
            <div className="survey-summary">
              <p>
                <strong>{surveyCells.length}</strong>
                <span>
                  {` ${surveyCells.length === 1 ? "square" : "squares"} · ${(surveyCells.length * surveySizeNm * surveySizeNm).toFixed(2)} NM²`}
                </span>
              </p>
              <div>
                <button
                  className="create-boat"
                  type="button"
                  disabled={selectedIds.length === 0}
                  onClick={() => dispatch(exploreSurvey())}
                >
                  Explore
                </button>
                <button type="button" onClick={() => dispatch(cellsCleared())}>Clear</button>
              </div>
            </div>
          </>
        )}

      </div>

      <footer className="fleet-panel-foot">
        <button type="button" onClick={() => dispatch(createBoat("TYPHOON"))}>
          <span aria-hidden="true">+</span> Add Typhoon
        </button>
        <button type="button" onClick={() => dispatch(createBoat("TEMPEST"))}>
          <span aria-hidden="true">+</span> Add Tempest
        </button>
      </footer>
    </div>
  );
}
