"use client";

import { boatSelected } from "../../store/commandSlice.ts";
import { useAppDispatch, useAppSelector } from "../../store/hooks.ts";
import { selectActivity, selectSelectedBoatId } from "../../store/selectors.ts";
import "./activityPanel.css";

// WHAT IS IN PROGRESS
//
// The list above says what the operator owns. This says what it is doing: one
// line per hull, named work, a bearing and a range for where it is going, and
// how far through its route it is.
//
// One measure at the top — mean speed over mean rated speed — answers "how
// much of this fleet is actually moving" without being read line by line. It
// is deliberately not an average of progress: a hull holding station on a
// contact is working, and a progress average would have called it idle.
//
// A container, like the fleet panel: it reads the store rather than taking the
// whole fleet through the dashboard as props.

const KIND_LABEL: Record<string, string> = {
  MOVING: "Under way",
  HOLDING: "Holding",
  MANUAL: "Manual",
  IDLE: "Idle",
  FAULT: "Fault",
};

export default function ActivityPanel() {
  const dispatch = useAppDispatch();
  const activity = useAppSelector(selectActivity);
  const selectedBoatId = useAppSelector(selectSelectedBoatId);

  return (
    <section className="activity" aria-label="Fleet activity">
      <header className="activity-head">
        <div className="activity-title">
          <h2>Activity</h2>
          <span>
            {activity.underway} of {activity.total} under way
            {activity.faults > 0 && ` · ${activity.faults} fault`}
          </span>
        </div>

        {/* The measure, as a figure and as a bar: the figure to read, the bar
            to glance at. */}
        <div className="activity-measure">
          <strong>{Math.round(activity.effort * 100)}<em>%</em></strong>
          <span className="activity-measure-track" aria-hidden="true">
            <i style={{ width: `${Math.min(Math.max(activity.effort, 0), 1) * 100}%` }} />
          </span>
        </div>
      </header>

      {activity.entries.length === 0 ? (
        <p className="activity-empty">No vessels in the fleet.</p>
      ) : (
        <ul className="activity-list">
          {activity.entries.map((entry) => (
            <li key={entry.boatId}>
              <button
                className={`activity-row is-${entry.kind.toLowerCase()}${
                  entry.boatId === selectedBoatId ? " is-selected" : ""}`}
                type="button"
                onClick={() => dispatch(boatSelected(entry.boatId))}
              >
                <span className="activity-kind" aria-label={KIND_LABEL[entry.kind] ?? entry.kind} />

                <span className="activity-body">
                  <span className="activity-line">
                    <strong>{entry.name}</strong>
                    <em>{entry.speedKnots.toFixed(1)} kn</em>
                  </span>
                  <span className="activity-work">{entry.headline}</span>
                  <span className="activity-where">
                    <span>{entry.where}</span>
                    <span>{entry.eta}</span>
                  </span>

                  {/* No bar on a hull with no route: a progress track at zero
                      reads as "stuck at the start" rather than "not tasked". */}
                  {entry.progress !== null && (
                    <span className="activity-progress" aria-hidden="true">
                      <i style={{ width: `${entry.progress * 100}%` }} />
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
