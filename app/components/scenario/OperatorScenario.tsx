"use client";

import { useAppDispatch, useAppSelector } from "../../store/hooks.ts";
import {
  acknowledgeDemoAlert,
  closeDemoScenario,
  injectDemoLinkLoss,
  launchDemoScenario,
  prepareDemoScenario,
  resetDemoScenario,
  resolveDemoScenario,
} from "../../store/orders.ts";
import {
  SCENARIO_PHASE_INDEX,
  SCENARIO_STEP_COUNT,
  scenarioStep,
  type ScenarioPhase,
} from "../../store/scenarioSlice.ts";
import "./operatorScenario.css";

const STEPS = ["Select 3", "Assign patrol", "Underway", "Link loss", "Respond"] as const;

const COPY: Record<ScenarioPhase, { title: string; detail: string; action: string }> = {
  BRIEF: {
    title: "Harbor patrol 01",
    detail: "Load a known three-vessel team and frame the mission area.",
    action: "Select three vessels",
  },
  READY: {
    title: "Team ready",
    detail: "Three hulls selected. Assign the perimeter and release them to autonomy.",
    action: "Assign + launch patrol",
  },
  ACTIVE: {
    title: "Mission underway",
    detail: "All three vessels are navigating the patrol. Inject the planned exception.",
    action: "Simulate TY-02 link loss",
  },
  LINK_LOST: {
    title: "Command link lost",
    detail: "TY-02 entered its onboard safety hold. Confirm that the operator has the alert.",
    action: "Acknowledge alert",
  },
  ACKNOWLEDGED: {
    title: "Intervention required",
    detail: "Keep TY-02 isolated in HOLD and re-task the healthy pair around the same area.",
    action: "Continue patrol with two",
  },
  RESOLVED: {
    title: "Mission stabilized",
    detail: "TY-02 is held safely; TY-01 and TP-01 continue the patrol as a two-vessel team.",
    action: "Replay scenario",
  },
};

/**
 * THE GUIDED WORKFLOW
 *
 * A fixed five-step script over the live console, and nothing more: every
 * button here dispatches the same orders the operator could give by hand, so
 * the demo cannot show behaviour the console does not have.
 *
 * It is a toggle, not furniture. Closing it takes the panel off the chart and
 * leaves the fleet running: the coach narrates the console, it does not drive
 * it. The switch is in the chart tool rail, and re-opening resumes the step.
 */
export default function OperatorScenario() {
  const dispatch = useAppDispatch();
  const scenario = useAppSelector((state) => state.scenario);
  const index = SCENARIO_PHASE_INDEX[scenario.phase];
  const copy = COPY[scenario.phase];
  const latest = scenario.events.at(-1);
  const step = scenarioStep(scenario.phase);
  const running = scenario.phase !== "BRIEF";

  function advance(): void {
    switch (scenario.phase) {
      case "BRIEF":
        dispatch(prepareDemoScenario());
        break;
      case "READY":
        dispatch(launchDemoScenario());
        break;
      case "ACTIVE":
        dispatch(injectDemoLinkLoss());
        break;
      case "LINK_LOST":
        dispatch(acknowledgeDemoAlert());
        break;
      case "ACKNOWLEDGED":
        dispatch(resolveDemoScenario());
        break;
      case "RESOLVED":
        dispatch(resetDemoScenario());
        break;
    }
  }

  // Closed means closed: the chart is handed back whole, and the tool rail
  // holds the switch that brings the coach back at the same step.
  if (!scenario.open) return null;

  return (
    <section
      className={`operator-scenario${scenario.phase === "LINK_LOST" ? " is-alert" : ""}`}
      aria-label="Harbor patrol demonstration"
    >
      <div className="scenario-bar">
        <div className="scenario-progress" aria-label={`Scenario step ${step} of ${SCENARIO_STEP_COUNT}`}>
          {STEPS.map((stepLabel, stepIndex) => (
            <span
              className={`${stepIndex < index ? "is-complete" : ""}${stepIndex === index ? " is-current" : ""}`}
              key={stepLabel}
            >
              <i aria-hidden="true">{stepIndex < index ? "✓" : stepIndex + 1}</i>
              {stepLabel}
            </span>
          ))}
        </div>

        <div className="scenario-controls">
          <button
            className="scenario-chip"
            type="button"
            onClick={() => dispatch(resetDemoScenario())}
            disabled={!running}
            aria-label="Restart the scenario from the brief"
            title="Restart from the brief"
          >
            <svg viewBox="0 0 22 22" aria-hidden="true">
              <path d="M4 11 A7 7 0 1 1 7.6 17.1" />
              <path d="M4 5.5 L4 11 L9.5 11" />
            </svg>
          </button>
          <button
            className="scenario-chip"
            type="button"
            onClick={() => dispatch(closeDemoScenario())}
            aria-label="Close the guided demo"
            title="Close — the fleet keeps running"
          >
            <svg viewBox="0 0 22 22" aria-hidden="true">
              <path d="M6 6 L16 16 M16 6 L6 16" />
            </svg>
          </button>
        </div>
      </div>

      <div className="scenario-command">
        <div className="scenario-copy">
          <p className="eyebrow">Guided scenario · step {step} of {SCENARIO_STEP_COUNT}</p>
          <h2>{copy.title}</h2>
          <p>{copy.detail}</p>
          {latest && (
            <small data-tone={latest.tone.toLowerCase()}>
              <span aria-hidden="true" />
              {latest.label}
            </small>
          )}
        </div>

        <button type="button" onClick={advance}>
          {copy.action}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
