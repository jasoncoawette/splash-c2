import assert from "node:assert/strict";
import test from "node:test";

import {
  ballastBalance,
  hasEstimate,
  subsystemsOf,
} from "../app/components/vessel/subsystems.ts";

const typhoon = {
  id: "typhoon-01",
  name: "TY-01",
  type: "TYPHOON",
  maximumSpeedKnots: 45,
  maximumRangeNm: 120,
};

const tempest = {
  id: "tempest-01",
  name: "TM-01",
  type: "TEMPEST",
  maximumSpeedKnots: 38,
  maximumRangeNm: 200,
};

function stateFor(overrides = {}) {
  return {
    id: "typhoon-01",
    position: { latitude: 33.712, longitude: -118.229 },
    headingDegrees: 90,
    speedKnots: 0,
    energyPercent: 100,
    mode: "IDLE",
    role: null,
    missionId: null,
    waypointIndex: 0,
    ...overrides,
  };
}

test("a part the hull does not carry has no window", () => {
  const towered = subsystemsOf(typhoon, stateFor()).map((part) => part.id);
  const flat = subsystemsOf(tempest, stateFor({ id: "tempest-01" })).map((part) => part.id);

  assert.ok(towered.includes("TURRET"));
  assert.ok(towered.includes("COMMS"));
  assert.ok(!flat.includes("TURRET"));
  assert.ok(!flat.includes("COMMS"));
  // Everything that is not on the tower is on both classes.
  assert.deepEqual(flat, ["DRIVE", "STEERING", "POWER", "HULL", "DECK", "NAV"]);
});

test("a pin lands on the geometry it points at", () => {
  const parts = subsystemsOf(typhoon, stateFor());
  const drive = parts.find((part) => part.id === "DRIVE");
  const nav = parts.find((part) => part.id === "NAV");

  // The drive hangs off the transom under the water; navigation is forward and
  // above the deck. If the spec changes length, both move with it.
  assert.ok(drive.anchor.y < -1.9, "drive sits aft of the transom");
  assert.ok(drive.anchor.z < 0, "drive sits below the waterline");
  assert.ok(nav.anchor.y > 1.5, "navigation sits forward");
  assert.ok(nav.anchor.z > 0.4, "navigation sits above the deck");
});

test("the drives report the turn, not just the speed", () => {
  const under_way = stateFor({ speedKnots: 22.5, mode: "MISSION", missionId: "m1" });
  const straight = subsystemsOf(typhoon, under_way, { rudderDegrees: 0 });
  const turning = subsystemsOf(typhoon, under_way, { rudderDegrees: 35 });

  const shafts = (parts) => parts
    .find((part) => part.id === "DRIVE")
    .channels
    .filter((channel) => channel.label.endsWith("shaft"))
    .map((channel) => Number.parseFloat(channel.value));

  const [portStraight, starboardStraight] = shafts(straight);
  const [portTurning, starboardTurning] = shafts(turning);

  const evenSplit = Math.abs(portStraight - starboardStraight);
  const turnSplit = portTurning - starboardTurning;

  assert.ok(turnSplit > 300, "full rudder loads one shaft and unloads the other");
  assert.ok(
    evenSplit < turnSplit / 10,
    "with the rudder amidships the shafts read as even",
  );
  assert.equal(straight.find((part) => part.id === "DRIVE").status, "ACTIVE");
});

test("a stopped hull reports standby drives and no endurance figure", () => {
  const parts = subsystemsOf(typhoon, stateFor({ speedKnots: 0 }));

  assert.equal(parts.find((part) => part.id === "DRIVE").status, "STANDBY");
  const endurance = parts
    .find((part) => part.id === "POWER")
    .channels
    .find((channel) => channel.label === "Endurance");
  assert.equal(endurance.value, "—", "range over zero speed is not a number of hours");
});

test("low charge degrades power rather than reading nominal", () => {
  const parts = subsystemsOf(typhoon, stateFor({ energyPercent: 11, speedKnots: 10 }));
  const power = parts.find((part) => part.id === "POWER");

  assert.equal(power.status, "DEGRADED");
  assert.match(power.summary, /low/i);
});

test("a lost link takes the turret and the radios offline", () => {
  const parts = subsystemsOf(
    typhoon,
    stateFor({ mode: "MISSION", missionId: "m1", speedKnots: 0 }),
    { linked: false },
  );

  assert.equal(parts.find((part) => part.id === "COMMS").status, "OFFLINE");
  assert.equal(parts.find((part) => part.id === "TURRET").status, "OFFLINE");
  assert.equal(parts.find((part) => part.id === "DRIVE").status, "OFFLINE");
  // Dead reckoning rather than a GNSS fix it cannot be receiving.
  const fix = parts
    .find((part) => part.id === "NAV")
    .channels
    .find((channel) => channel.label === "Fix");
  assert.equal(fix.value, "Dead reckoning");
});

test("every derived reading is labelled, and the deck's geometry is not", () => {
  const parts = subsystemsOf(typhoon, stateFor({ speedKnots: 12 }), { rudderDegrees: 10 });

  for (const id of ["DRIVE", "POWER", "HULL", "TURRET", "COMMS"]) {
    assert.ok(hasEstimate(parts.find((part) => part.id === id)), `${id} carries an estimate`);
  }

  const deck = parts.find((part) => part.id === "DECK");
  assert.equal(hasEstimate(deck), false, "deck numbers come off the spec, measured");
});

test("the same run reads the same twice", () => {
  const state = stateFor({ speedKnots: 18, mode: "MISSION", missionId: "m1" });
  const context = { rudderDegrees: 12, elapsedSeconds: 61.5 };

  assert.deepEqual(
    subsystemsOf(typhoon, state, context),
    subsystemsOf(typhoon, state, context),
  );
});

test("ballast is level upright and leans with the rudder", () => {
  assert.deepEqual(ballastBalance(20, 45, 0), {
    portPercent: 50,
    starboardPercent: 50,
    shift: 0,
  });

  const turning = ballastBalance(45, 45, 35);
  assert.equal(turning.shift, 8, "full rudder at full speed is the stop");
  assert.equal(turning.portPercent, 42);
  assert.equal(turning.starboardPercent, 58);

  // Stopped, the rudder cannot heel the hull at all.
  assert.equal(ballastBalance(0, 45, 35).shift, 0);
});
