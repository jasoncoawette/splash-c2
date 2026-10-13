"use client";

import { useEffect } from "react";
import type { MissionPattern } from "../core/missionPlanner.ts";
import type {BoatId } from "../core/types";
import {
  detailPanelToggled,
  fleetPanelToggled,
  boatsSelected,
  toolSelected,
  viewChanged,
  type ConsoleView,
  type ChartTool,
} from "../store/commandSlice.ts";
import { boatRecalled } from "../store/fleetSlice.ts";
import type { FollowMode } from "../core/followTarget.ts";
import { useAppDispatch, useAppSelector } from "../store/hooks.ts";
import {
  removeBoat as orderRemoveBoat,
  followSelection as orderFollowSelection,
  routeSelection as orderRouteSelection,
  simulationTicked,
  nudgeOrbit as orderNudgeOrbit,
  takeOver as orderTakeOver,
  toggleDemoScenario as orderToggleDemoScenario,
  toggleManual as orderToggleManual,
} from "../store/orders.ts";
import { TICK_SECONDS } from "../store/seed.ts";
import { SCENARIO_STEP_COUNT, scenarioStep } from "../store/scenarioSlice.ts";
import {
  selectDetailPanelOpen,
  selectFleetPanelOpen,
  selectChartTool,
  selectBoatViews,
  selectNeighbours,
  selectHelmCamera,
  selectNotice,
  selectOrbit,
  selectRudderDegrees,
  selectSelectedBoat,
  selectSelectedBoatId,
  selectSelectedDefinition,
  selectSelectedIds,
  selectSelectedMission,
  selectView,
} from "../store/selectors.ts";
import ConsoleShell from "./panels/ConsoleShell";
import FleetPanel from "./panels/FleetPanel";
import ChartToolbar from "./map/ChartToolbar";
import VesselOutline from "./outline/VesselOutline";
import FleetMap from "./FleetMap";
import { HelmView } from "./helm";
import OperatorScenario from "./scenario/OperatorScenario";

// THE CONSOLE CONTAINER
//
// This component holds no state. Boat state, telemetry and operator intent all
// live in the store, so there is one owner for each rather than a useState per
// panel. Everything below the hooks is a setter-shaped wrapper, which keeps the
// panels unaware that a store exists: they still take plain props and plain
// callbacks, and can be rendered in a test without a Provider.

export default function FleetDashboard() {
  const dispatch = useAppDispatch();

  const boats = useAppSelector(selectBoatViews);
  const neighbours = useAppSelector(selectNeighbours);
  const selectedBoatId = useAppSelector(selectSelectedBoatId);
  const selectedIds = useAppSelector(selectSelectedIds);
  const selectedBoat = useAppSelector(selectSelectedBoat);
  const selectedDefinition = useAppSelector(selectSelectedDefinition);
  const selectedMission = useAppSelector(selectSelectedMission);
  const notice = useAppSelector(selectNotice);
  const safetyAlert = useAppSelector((state) => state.fleet.safetyAlert);
  const contacts = useAppSelector((state) => state.traffic.contacts);
  const targetMmsi = useAppSelector((state) => state.traffic.targetMmsi);
  const theme = useAppSelector((state) => state.appearance?.theme ?? "DARK");
  const view = useAppSelector(selectView);
  const fleetPanelOpen = useAppSelector(selectFleetPanelOpen);
  const detailPanelOpen = useAppSelector(selectDetailPanelOpen);
  const chartTool = useAppSelector(selectChartTool);
  const rudderDegrees = useAppSelector(selectRudderDegrees);
  const helmCamera = useAppSelector(selectHelmCamera);
  const orbit = useAppSelector(selectOrbit);
  // The helm draws the same objective the chart does, so it reads it from the
  // same place rather than being handed a copy.
  const objective = useAppSelector((state) => state.command.objective);
  const radiusNm = useAppSelector((state) => state.command.radiusNm);
  const demoOpen = useAppSelector((state) => state.scenario.open);
  const demoPhase = useAppSelector((state) => state.scenario.phase);

  // The clock lives in the adapter. Each tick dispatches one order, which hands
  // the core a fixed delta rather than wall-clock time, so a run replays to the
  // same result. The interval owns no state of its own.
  useEffect(() => {
    document.documentElement.dataset.theme = theme === "LIGHT" ? "light" : "dark";
  }, [theme]);

  useEffect(() => {
    const timer = setInterval(() => dispatch(simulationTicked()), TICK_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [dispatch]);

  const setView = (next: ConsoleView) => dispatch(viewChanged(next));
  const setFleetPanelOpen = (open: boolean) => dispatch(fleetPanelToggled(open));
  const setDetailPanelOpen = (open: boolean) => dispatch(detailPanelToggled(open));
  const orbitBy = (delta: { yaw?: number; pitch?: number; distance?: number }) =>
    dispatch(orderNudgeOrbit(delta));
  const setChartTool = (next: ChartTool) => dispatch(toolSelected(next));

  const selectBoats = (boatIds: readonly string[]) => {
    dispatch(boatsSelected(boatIds));
    // Picking a vessel is a request to see it. Clearing is not.
  };
  const removeBoat = (boatId: BoatId) => dispatch(orderRemoveBoat(boatId));
  const routeSelection = (pattern: MissionPattern) => dispatch(orderRouteSelection(pattern));
  const followWith = (mode: FollowMode) => dispatch(orderFollowSelection(mode));
  const toggleManual = (manual: boolean) => dispatch(orderToggleManual(manual));
  const takeOver = (boatId: BoatId) => dispatch(orderTakeOver(boatId));
  const recall = (boatId: BoatId) => dispatch(boatRecalled(boatId));
  const toggleDemo = () => dispatch(orderToggleDemoScenario());

  return (
    <main className="c2-shell" data-view={view.toLowerCase()}>
      {view === "HELM" && selectedBoat && selectedDefinition ? (
        <HelmView
          boat={selectedBoat}
          definition={selectedDefinition}
          mission={selectedMission}
          neighbours={neighbours}
          rudderDegrees={rudderDegrees}
          objective={objective}
          objectiveRadiusNm={radiusNm}
          traffic={contacts}
          theme={theme}
          camera={helmCamera}
          orbit={orbit}
          onOrbit={orbitBy}
          onToggleManual={toggleManual}
          onRecall={() => recall(selectedBoatId)}
          onZoomOut={() => {
            setView("FLEET");
            setFleetPanelOpen(true);
          }}
        />
      ) : (
        <ConsoleShell
          fleetOpen={fleetPanelOpen}
          detailOpen={detailPanelOpen}
          onFleetToggle={setFleetPanelOpen}
          onDetailToggle={setDetailPanelOpen}
          fleet={(
            <FleetPanel />
          )}
          detail={selectedBoat && selectedDefinition ? (
            <section className="vessel-detail" aria-label={selectedDefinition.name}>
              <div className="panel-heading">
                <div className="panel-title">
                  <span className="panel-mark" aria-hidden="true">
                    <VesselOutline type={selectedDefinition.type} />
                  </span>
                  <div>
                    <h1>{selectedDefinition.name}</h1>
                    <p className="dock-status">
                      <span>{selectedDefinition.type}</span>
                      <span>{selectedBoat.mode}</span>
                      {selectedBoat.role && <span>{selectedBoat.role}</span>}
                    </p>
                  </div>
                </div>
              </div>

              <div className="detail-body">
                <div className="vessel-data">
                  <span>Heading</span>
                  <strong>{selectedBoat.headingDegrees.toFixed(0)}°</strong>
                  <span>Speed</span>
                  <strong>{selectedBoat.speedKnots.toFixed(1)} kn</strong>
                  <span>Charge</span>
                  <strong>{selectedBoat.energyPercent.toFixed(0)}%</strong>
                  <span>Leg</span>
                  <strong>
                    {selectedMission
                      ? `${selectedBoat.waypointIndex + 1} of ${selectedMission.waypoints.length}`
                      : "—"}
                  </strong>
                  <span>Objective</span>
                  <strong>
                    {selectedMission?.objective?.label ?? "No active objective"}
                  </strong>
                </div>

              </div>

              <div className="detail-actions">
                <button
                  className="ghost-button is-primary is-wide"
                  type="button"
                  onClick={() => takeOver(selectedBoatId)}
                >
                  Open front view
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => recall(selectedBoatId)}
                  disabled={selectedBoat.missionId === null}
                >
                  Recall
                </button>
                <button
                  className="ghost-button is-quiet"
                  type="button"
                  onClick={() => removeBoat(selectedBoatId)}
                >
                  Remove vessel
                </button>
              </div>
            </section>
          ) : null}
        >
          <FleetMap />

          {/* A rejected order has to be visible even with the panel collapsed,
              so the notice rides on the chart rather than inside the dock. */}
          <ChartToolbar
            tool={chartTool}
            onToolChange={setChartTool}
            selectedCount={selectedIds.length}
            targetName={contacts.find((contact) => contact.mmsi === targetMmsi)?.name ?? null}
            onRoute={routeSelection}
            onFollow={followWith}
            onSelectAll={() => selectBoats(boats.map(({ state }) => state.id))}
            onClearSelection={() => selectBoats([])}
            demoOpen={demoOpen}
            demoStep={demoPhase === "BRIEF"
              ? null
              : `${scenarioStep(demoPhase)}/${SCENARIO_STEP_COUNT}`}
            onDemoToggle={toggleDemo}
          />

          {(notice || safetyAlert) && (
            <p className="console-notice" role="alert">
              {notice ?? `${safetyAlert?.boatId.toUpperCase()} collision-avoidance hold · ${safetyAlert?.hazardLabel}`}
            </p>
          )}
          <OperatorScenario />
        </ConsoleShell>
      )}
    </main>
  );
}
