import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { assignMission } from "../app/core/assignMission.ts";
import { createBoatState } from "../app/core/createBoat.ts";

const typhoon = {
  id: "typhoon-01",
  name: "TYPHOON-01",
  type: "TYPHOON",
  maximumSpeedKnots: 50,
  maximumRangeNm: 100,
};

const tempest = {
  id: "tempest-01",
  name: "TEMPEST-01",
  type: "TEMPEST",
  maximumSpeedKnots: 25,
  maximumRangeNm: 100,
};

const patrolMission = {
  id: "patrol-alpha",
  role: "PATROL",
  waypoints: [
    { latitude: 33.728, longitude: -118.255 },
    { latitude: 33.735, longitude: -118.24 },
    { latitude: 33.742, longitude: -118.23 },
  ],
};

describe("createBoatState", () => {
  test("creates a deterministic idle state without mutating the position", () => {
    const position = { latitude: 33.728, longitude: -118.255 };
    const boat = createBoatState(typhoon, position);

    assert.deepEqual(boat, {
      id: "typhoon-01",
      position,
      headingDegrees: 0,
      speedKnots: 0,
      energyPercent: 100,
      mode: "IDLE",
      role: null,
      missionId: null,
      waypointIndex: 0,
    });
    assert.notEqual(boat.position, position);
  });

  test("rejects invalid external data", () => {
    assert.throws(
      () => createBoatState(typhoon, { latitude: 91, longitude: 0 }),
      /Latitude must be between -90 and 90/,
    );
    assert.throws(
      () => createBoatState({ ...typhoon, id: "" }, { latitude: 0, longitude: 0 }),
      /Boat ID is required/,
    );
  });
});

describe("assignMission", () => {
  test("updates one boat without mutating either input", () => {
    const idleBoat = createBoatState(typhoon, patrolMission.waypoints[0]);
    const originalBoat = structuredClone(idleBoat);
    const originalMission = structuredClone(patrolMission);

    const assignedBoat = assignMission(idleBoat, patrolMission);

    assert.deepEqual(idleBoat, originalBoat);
    assert.deepEqual(patrolMission, originalMission);
    assert.notEqual(assignedBoat, idleBoat);
    assert.equal(assignedBoat.mode, "MISSION");
    assert.equal(assignedBoat.missionId, "patrol-alpha");
    assert.equal(assignedBoat.role, "PATROL");
    assert.equal(assignedBoat.waypointIndex, 0);
  });

  test("rejects missions without valid waypoints", () => {
    const boat = createBoatState(typhoon, { latitude: 33.728, longitude: -118.255 });

    assert.throws(
      () => assignMission(boat, { ...patrolMission, waypoints: [] }),
      /Mission requires at least one waypoint/,
    );
    assert.throws(
      () => assignMission(boat, {
        ...patrolMission,
        waypoints: [{ latitude: 33.728, longitude: -181 }],
      }),
      /Longitude must be between -180 and 180/,
    );
  });

  test("changes only the assigned boat in the two-boat slice", () => {
    const firstBoat = createBoatState(typhoon, { latitude: 33.728, longitude: -118.255 });
    const secondBoat = createBoatState(tempest, { latitude: 33.72, longitude: -118.25 });
    const fleet = {
      [firstBoat.id]: firstBoat,
      [secondBoat.id]: secondBoat,
    };

    const nextFleet = {
      ...fleet,
      [firstBoat.id]: assignMission(firstBoat, patrolMission),
    };

    assert.equal(nextFleet["typhoon-01"].mode, "MISSION");
    assert.deepEqual(nextFleet["tempest-01"], secondBoat);
    assert.equal(nextFleet["tempest-01"].mode, "IDLE");
  });
});
