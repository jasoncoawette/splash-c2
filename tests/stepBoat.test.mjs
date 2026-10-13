import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { assignMission } from "../app/core/assignMission.ts";
import { createBoatState } from "../app/core/createBoat.ts";
import { distanceBetween } from "../app/core/navigation.ts";
import { stepBoat } from "../app/core/stepBoat.ts";

const definition = {
  id: "typhoon-01",
  name: "TYPHOON-01",
  type: "TYPHOON",
  maximumSpeedKnots: 50,
  maximumRangeNm: 100,
};

const mission = {
  id: "patrol-alpha",
  role: "PATROL",
  waypoints: [
    { latitude: 0, longitude: 1 },
    { latitude: 0, longitude: 2 },
    { latitude: 1, longitude: 2 },
  ],
};

function missionBoat(speedKnots = 20) {
  return {
    ...assignMission(
      createBoatState(definition, { latitude: 0, longitude: 0 }),
      mission,
    ),
    speedKnots,
  };
}

describe("stepBoat", () => {
  test("moves at knots converted through elapsed seconds without mutating inputs", () => {
    const boat = missionBoat(20);
    const originalBoat = structuredClone(boat);
    const originalMission = structuredClone(mission);
    const result = stepBoat(boat, definition, mission, 900);

    assert.deepEqual(boat, originalBoat);
    assert.deepEqual(mission, originalMission);
    assert.notEqual(result, boat);
    assert.ok(Math.abs(distanceBetween(boat.position, result.position) - 5) < 0.000001);
    assert.equal(result.headingDegrees, 90);
    assert.equal(result.waypointIndex, 0);
    assert.equal(result.mode, "MISSION");
  });

  test("advances to the next waypoint on exact arrival", () => {
    const boat = missionBoat(20);
    const firstLegNm = distanceBetween(boat.position, mission.waypoints[0]);
    const result = stepBoat(
      boat,
      definition,
      mission,
      (firstLegNm / boat.speedKnots) * 3600,
    );

    assert.deepEqual(result.position, mission.waypoints[0]);
    assert.equal(result.waypointIndex, 1);
    assert.equal(result.mode, "MISSION");
  });

  test("uses a large tick across waypoints and completes without overshooting", () => {
    const boat = missionBoat(20);
    const routeDistanceNm =
      distanceBetween(boat.position, mission.waypoints[0]) +
      distanceBetween(mission.waypoints[0], mission.waypoints[1]) +
      distanceBetween(mission.waypoints[1], mission.waypoints[2]);
    const result = stepBoat(
      boat,
      definition,
      mission,
      ((routeDistanceNm + 10) / boat.speedKnots) * 3600,
    );

    assert.deepEqual(result.position, mission.waypoints[2]);
    assert.equal(result.headingDegrees, 0);
    assert.equal(result.speedKnots, 0);
    assert.equal(result.mode, "HOLD");
    assert.equal(result.role, null);
    assert.equal(result.missionId, null);
    assert.equal(result.waypointIndex, 0);
  });

  test("skips a waypoint that is already the current position", () => {
    const missionWithStartingWaypoint = {
      ...mission,
      waypoints: [
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 1 },
      ],
    };
    const boat = {
      ...assignMission(
        createBoatState(definition, { latitude: 0, longitude: 0 }),
        missionWithStartingWaypoint,
      ),
      speedKnots: 20,
    };
    const result = stepBoat(boat, definition, missionWithStartingWaypoint, 900);

    assert.equal(result.waypointIndex, 1);
    assert.ok(result.position.longitude > 0);
  });

  test("leaves IDLE, HOLD, zero-speed, and zero-time boats unchanged", () => {
    const idle = createBoatState(definition, { latitude: 0, longitude: 0 });
    const hold = { ...idle, mode: "HOLD" };
    const stoppedMission = missionBoat(0);
    const movingMission = missionBoat(20);

    assert.equal(stepBoat(idle, definition, null, 60), idle);
    assert.equal(stepBoat(hold, definition, null, 60), hold);
    assert.equal(stepBoat(stoppedMission, definition, mission, 60), stoppedMission);
    assert.equal(stepBoat(movingMission, definition, mission, 0), movingMission);
  });

  test("rejects invalid elapsed time, state, definition, and mission links", () => {
    const boat = missionBoat(20);

    assert.throws(
      () => stepBoat(boat, definition, mission, -1),
      /Elapsed time must be a non-negative finite number/,
    );
    assert.throws(
      () => stepBoat(boat, { ...definition, id: "other" }, mission, 1),
      /Boat state and definition IDs must match/,
    );
    assert.throws(
      () => stepBoat({ ...boat, speedKnots: 51 }, definition, mission, 1),
      /Boat speed must be between zero and its maximum speed/,
    );
    assert.throws(
      () => stepBoat(boat, definition, null, 1),
      /Mission mode requires the boat's assigned mission/,
    );
    assert.throws(
      () => stepBoat(boat, definition, { ...mission, id: "other" }, 1),
      /Mission mode requires the boat's assigned mission/,
    );
  });
});

describe("manual helm", () => {
  test("runs the boat on its own heading and keeps its mission", () => {
    const boat = { ...missionBoat(30), mode: "MANUAL", headingDegrees: 90 };
    const next = stepBoat(boat, definition, mission, 3600);

    assert.equal(next.mode, "MANUAL");
    assert.equal(next.missionId, mission.id);
    assert.equal(next.waypointIndex, 0);
    assert.equal(next.headingDegrees, 90);
    assert.ok(Math.abs(distanceBetween(boat.position, next.position) - 30) < 1e-6);
  });

  test("holds position with no throttle and leaves its input unchanged", () => {
    const boat = { ...missionBoat(0), mode: "MANUAL", headingDegrees: 90 };

    assert.equal(stepBoat(boat, definition, mission, 3600), boat);
    assert.deepEqual(boat.position, { latitude: 0, longitude: 0 });
  });
});
