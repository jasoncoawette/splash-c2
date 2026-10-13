import assert from "node:assert/strict";
import test from "node:test";

import {
  addBoatToFleet,
  assignFleetMission,
  createFleet,
  holdBoat,
  removeBoatFromFleet,
  stepFleet,
} from "../app/simulator/fleet.ts";

const typhoon = {
  id: "typhoon-01",
  name: "Typhoon One",
  type: "TYPHOON",
  maximumSpeedKnots: 45,
  maximumRangeNm: 400,
};

const tempest = {
  id: "tempest-01",
  name: "Tempest One",
  type: "TEMPEST",
  maximumSpeedKnots: 35,
  maximumRangeNm: 500,
};

const seeds = [
  {
    definition: typhoon,
    position: { latitude: 33.74, longitude: -118.28 },
  },
  {
    definition: tempest,
    position: { latitude: 33.72, longitude: -118.24 },
  },
];

const patrolMission = {
  id: "patrol-01",
  role: "PATROL",
  waypoints: [
    { latitude: 33.76, longitude: -118.25 },
    { latitude: 33.78, longitude: -118.2 },
    { latitude: 33.74, longitude: -118.16 },
  ],
};

function fleetWithMovingPatrol() {
  const fleet = createFleet(seeds);
  const movingFleet = {
    ...fleet,
    boats: {
      ...fleet.boats,
      [typhoon.id]: {
        ...fleet.boats[typhoon.id],
        speedKnots: 20,
      },
    },
  };

  return assignFleetMission(movingFleet, typhoon.id, patrolMission);
}

test("creates a fleet from fixed seeds", () => {
  const fleet = createFleet(seeds);

  assert.deepEqual(Object.keys(fleet.definitions), [typhoon.id, tempest.id]);
  assert.deepEqual(Object.keys(fleet.boats), [typhoon.id, tempest.id]);
  assert.deepEqual(fleet.missions, {});
  assert.equal(fleet.boats[typhoon.id].mode, "IDLE");
  assert.equal(fleet.boats[tempest.id].mode, "IDLE");
});

test("rejects duplicate boat IDs", () => {
  assert.throws(
    () => createFleet([seeds[0], { ...seeds[1], definition: typhoon }]),
    /Duplicate boat ID: typhoon-01/,
  );
});

test("adds a created boat without mutating the fleet", () => {
  const fleet = createFleet([seeds[0]]);
  const expanded = addBoatToFleet(fleet, seeds[1]);

  assert.equal(fleet.boats[tempest.id], undefined);
  assert.equal(expanded.definitions[tempest.id], tempest);
  assert.deepEqual(expanded.boats[tempest.id].position, seeds[1].position);
  assert.equal(expanded.boats[tempest.id].mode, "IDLE");
  assert.equal(expanded.boats[typhoon.id], fleet.boats[typhoon.id]);
});

test("rejects adding a duplicate boat", () => {
  const fleet = createFleet(seeds);

  assert.throws(
    () => addBoatToFleet(fleet, seeds[0]),
    /Duplicate boat ID: typhoon-01/,
  );
});

test("removes a boat without mutating the fleet or its neighbours", () => {
  const fleet = createFleet(seeds);
  const reduced = removeBoatFromFleet(fleet, typhoon.id);

  assert.equal(reduced.boats[typhoon.id], undefined);
  assert.equal(reduced.definitions[typhoon.id], undefined);
  assert.equal(reduced.boats[tempest.id], fleet.boats[tempest.id]);
  assert.equal(reduced.definitions[tempest.id], tempest);
  assert.notEqual(fleet.boats[typhoon.id], undefined);
});

test("drops the mission that belonged to a removed boat and keeps the others", () => {
  const assigned = assignFleetMission(createFleet(seeds), typhoon.id, patrolMission);
  const otherMission = { ...patrolMission, id: "patrol-02" };
  const bothTasked = assignFleetMission(assigned, tempest.id, otherMission);
  const reduced = removeBoatFromFleet(bothTasked, typhoon.id);

  assert.equal(reduced.missions[patrolMission.id], undefined);
  assert.equal(reduced.missions[otherMission.id], otherMission);
});

test("rejects removal of an unknown boat", () => {
  assert.throws(
    () => removeBoatFromFleet(createFleet(seeds), "missing"),
    /Unknown boat ID: missing/,
  );
});

test("allows a removed boat ID to be created again", () => {
  const fleet = createFleet(seeds);
  const reduced = removeBoatFromFleet(fleet, typhoon.id);
  const rebuilt = addBoatToFleet(reduced, seeds[0]);

  assert.equal(rebuilt.definitions[typhoon.id], typhoon);
  assert.equal(rebuilt.boats[typhoon.id].mode, "IDLE");
});

test("assigns a mission immutably to one boat", () => {
  const fleet = createFleet(seeds);
  const assigned = assignFleetMission(fleet, typhoon.id, patrolMission);

  assert.equal(fleet.boats[typhoon.id].mode, "IDLE");
  assert.equal(assigned.boats[typhoon.id].mode, "MISSION");
  assert.equal(assigned.boats[typhoon.id].missionId, patrolMission.id);
  assert.equal(assigned.missions[patrolMission.id], patrolMission);
  assert.equal(assigned.boats[tempest.id], fleet.boats[tempest.id]);
});

test("a safety hold stops a mission boat without discarding its mission", () => {
  const assigned = fleetWithMovingPatrol();
  const held = holdBoat(assigned, typhoon.id);

  assert.equal(assigned.boats[typhoon.id].mode, "MISSION");
  assert.equal(assigned.boats[typhoon.id].speedKnots, 20);
  assert.equal(held.boats[typhoon.id].mode, "HOLD");
  assert.equal(held.boats[typhoon.id].speedKnots, 0);
  assert.equal(held.boats[typhoon.id].missionId, patrolMission.id);
  assert.equal(held.missions[patrolMission.id], patrolMission);
});

test("rejects assignment to an unknown boat", () => {
  assert.throws(
    () => assignFleetMission(createFleet(seeds), "missing", patrolMission),
    /Unknown boat ID: missing/,
  );
});

test("rejects replacement of an active mission", () => {
  const assigned = assignFleetMission(createFleet(seeds), typhoon.id, patrolMission);

  assert.throws(
    () => assignFleetMission(assigned, typhoon.id, {
      ...patrolMission,
      id: "patrol-02",
    }),
    /Boat already has an active mission: typhoon-01/,
  );
});

test("rejects reuse of a mission ID by another boat", () => {
  const assigned = assignFleetMission(createFleet(seeds), typhoon.id, patrolMission);

  assert.throws(
    () => assignFleetMission(assigned, tempest.id, patrolMission),
    /Duplicate mission ID: patrol-01/,
  );
});

test("steps a mission boat while leaving an idle boat unchanged", () => {
  const fleet = fleetWithMovingPatrol();
  const stepped = stepFleet(fleet, 900);

  assert.notDeepEqual(stepped.boats[typhoon.id].position, fleet.boats[typhoon.id].position);
  assert.equal(stepped.boats[tempest.id], fleet.boats[tempest.id]);
  assert.deepEqual(fleet.boats[typhoon.id].position, seeds[0].position);
});

test("replays the same fleet step deterministically", () => {
  const fleet = fleetWithMovingPatrol();

  assert.deepEqual(stepFleet(fleet, 900), stepFleet(fleet, 900));
});

test("does not mutate the input when a fleet step is invalid", () => {
  const fleet = fleetWithMovingPatrol();
  const invalidFleet = {
    ...fleet,
    missions: {},
  };
  const before = structuredClone(invalidFleet);

  assert.throws(
    () => stepFleet(invalidFleet, 900),
    /Missing mission for boat: typhoon-01/,
  );
  assert.deepEqual(invalidFleet, before);
});
