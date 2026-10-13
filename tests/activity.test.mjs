import assert from "node:assert/strict";
import test from "node:test";

import { routeProgress, summariseActivity } from "../app/store/activity.ts";

const anchorage = { latitude: 33.712, longitude: -118.229 };

function definition(id, name, maximumSpeedKnots = 45) {
  return { id, name, type: "TYPHOON", maximumSpeedKnots, maximumRangeNm: 120 };
}

function boat(id, overrides = {}) {
  return {
    id,
    position: { ...anchorage },
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

/** Three waypoints due north of the anchorage, a tenth of a degree apart. */
const route = [
  { latitude: 33.72, longitude: -118.229 },
  { latitude: 33.73, longitude: -118.229 },
  { latitude: 33.74, longitude: -118.229 },
];

function fleetOf(boats, missions = {}) {
  return {
    definitions: Object.fromEntries(
      boats.map((state, index) => [state.id, definition(state.id, `TY-0${index + 1}`)]),
    ),
    boats: Object.fromEntries(boats.map((state) => [state.id, state])),
    missions,
  };
}

test("an untasked fleet reports no activity at all", () => {
  const activity = summariseActivity(fleetOf([boat("typhoon-01")]));

  assert.equal(activity.total, 1);
  assert.equal(activity.underway, 0);
  assert.equal(activity.tasked, 0);
  assert.equal(activity.effort, 0);
  assert.equal(activity.entries[0].headline, "Idle, awaiting tasking");
  assert.equal(activity.entries[0].progress, null, "no route is not zero progress");
});

test("a tasked hull says what it is doing and where it is going", () => {
  const fleet = fleetOf(
    [boat("typhoon-01", {
      speedKnots: 22.5,
      mode: "MISSION",
      missionId: "m1",
      waypointIndex: 0,
    })],
    {
      m1: {
        id: "m1",
        role: "PATROL",
        waypoints: route,
        objective: { kind: "PATROL_AREA", position: route[1], label: "Harbour patrol" },
      },
    },
  );

  const [entry] = summariseActivity(fleet).entries;

  assert.equal(entry.kind, "MOVING");
  assert.equal(entry.headline, "Patrolling");
  // Due north of the anchorage, so the bearing is 000 and the range is read off
  // the great circle rather than guessed.
  assert.match(entry.where, /^000° · 0\.4[0-9] NM$/);
  assert.match(entry.eta, /min|under a minute/);
  assert.equal(entry.progress, 0, "nothing of the first leg is behind it yet");
  assert.equal(summariseActivity(fleet).tasked, 1);
});

test("a looping patrol is named as a circuit", () => {
  const fleet = fleetOf(
    [boat("typhoon-01", { speedKnots: 10, mode: "MISSION", missionId: "m1" })],
    {
      m1: {
        id: "m1",
        role: "PATROL",
        waypoints: route,
        loop: true,
        objective: { kind: "PATROL_AREA", position: route[0], label: "Ring" },
      },
    },
  );

  assert.equal(summariseActivity(fleet).entries[0].headline, "Patrolling · circuit");
});

test("an escort names the contact it is screening", () => {
  const fleet = fleetOf(
    [boat("typhoon-01", { speedKnots: 14, mode: "MISSION", missionId: "m1" })],
    {
      m1: {
        id: "m1",
        role: "PATROL",
        waypoints: route,
        stationKeeping: true,
        objective: { kind: "ESCORT_TARGET", position: route[0], label: "Screen" },
      },
    },
  );

  const activity = summariseActivity(fleet, {
    follows: [{ missionId: "m1", mode: "ESCORT", targetMmsi: 123456789, targetBoatId: null }],
    contacts: [{ mmsi: 123456789, name: "MAERSK ESSEX" }],
  });

  assert.equal(activity.entries[0].headline, "Escorting MAERSK ESSEX");
});

test("a parked escort reads as on station rather than as a zero range", () => {
  const station = { latitude: 33.712, longitude: -118.229 };
  const fleet = fleetOf(
    [boat("typhoon-01", { speedKnots: 0, mode: "MISSION", missionId: "m1" })],
    {
      m1: {
        id: "m1",
        role: "PATROL",
        waypoints: [station],
        stationKeeping: true,
      },
    },
  );

  const [entry] = summariseActivity(fleet).entries;

  assert.equal(entry.where, "On station");
  assert.equal(entry.eta, "holding");
  assert.equal(entry.kind, "HOLDING", "parked on purpose is not idle");
});

test("a lost link is a fault, and faults sort to the top", () => {
  const fleet = fleetOf([
    boat("typhoon-01", { speedKnots: 20, mode: "MISSION", missionId: "m1" }),
    boat("typhoon-02", { speedKnots: 0, mode: "MISSION", missionId: "m2" }),
  ], {
    m1: { id: "m1", role: "PATROL", waypoints: route },
    m2: { id: "m2", role: "PATROL", waypoints: route },
  });

  const activity = summariseActivity(fleet, { links: { "typhoon-02": "LOST" } });

  assert.equal(activity.entries[0].boatId, "typhoon-02");
  assert.equal(activity.entries[0].kind, "FAULT");
  assert.equal(activity.entries[0].headline, "Link lost · holding onboard");
  assert.equal(activity.entries[0].where, "Last reported position");
  assert.equal(activity.faults, 1);
  // The measure still reports the healthy hull as working.
  assert.equal(activity.underway, 1);
});

test("manual control is its own state, not a mission and not idle", () => {
  const fleet = fleetOf(
    [boat("typhoon-01", { speedKnots: 30, mode: "MANUAL", missionId: "m1" })],
    { m1: { id: "m1", role: "PATROL", waypoints: route } },
  );

  const [entry] = summariseActivity(fleet).entries;

  assert.equal(entry.kind, "MANUAL");
  assert.equal(entry.headline, "Under manual helm");
  assert.ok(entry.progress !== null, "the route it can be handed back to is still there");
});

test("the measure is speed against what the platform is rated for", () => {
  const fleet = fleetOf([
    boat("typhoon-01", { speedKnots: 45 }),
    boat("typhoon-02", { speedKnots: 0 }),
  ]);

  // One hull at its rated speed and one stopped is half the fleet's capacity.
  assert.equal(summariseActivity(fleet).effort, 0.5);
  assert.equal(summariseActivity(fleet).underway, 1);
});

test("progress counts legs flown, with credit for the leg under way", () => {
  const mission = { id: "m1", role: "PATROL", waypoints: route };

  assert.equal(routeProgress(mission, anchorage, 0), 0);
  assert.equal(routeProgress(mission, route[0], 1), 1 / 3);
  // Halfway between the first and second waypoints is half of the second leg.
  const halfway = { latitude: 33.725, longitude: -118.229 };
  assert.ok(Math.abs(routeProgress(mission, halfway, 1) - 0.5) < 0.01);
  assert.equal(routeProgress(mission, route[2], 3), 1, "past the last leg is done");
});
