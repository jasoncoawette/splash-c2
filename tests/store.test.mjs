import assert from "node:assert/strict";
import test from "node:test";

import { makeStore } from "../app/store/index.ts";
import {
  boatAdded,
  boatRecalled,
  fleetAdvanced,
  fleetRouted,
  manualSet,
} from "../app/store/fleetSlice.ts";
import {
  boatToggled,
  groupFormed,
  simRateChanged,
  subsystemToggled,
  subsystemsSet,
  THROTTLE_NOTCHES,
  THROTTLE_STOP_INDEX,
} from "../app/store/commandSlice.ts";
import { selectActivity } from "../app/store/selectors.ts";
import {
  closeDemoScenario,
  createBoat,
  acknowledgeDemoAlert,
  injectDemoLinkLoss,
  launchDemoScenario,
  prepareDemoScenario,
  removeBoat,
  resetDemoScenario,
  resolveDemoScenario,
  routeSelection,
  simulationTicked,
  toggleDemoScenario,
  stepThrottle,
  takeOver,
  toggleManual,
} from "../app/store/orders.ts";
import { telemetrySampled } from "../app/store/telemetrySlice.ts";
import { contactsReported } from "../app/store/trafficSlice.ts";

const anchorage = { latitude: 33.712, longitude: -118.229 };

function boatIds(store) {
  return Object.keys(store.getState().fleet.fleet.boats);
}

test("seeds the fleet and the selection from one place", () => {
  const store = makeStore();

  assert.deepEqual(boatIds(store), ["typhoon-01", "typhoon-02", "tempest-01"]);
  assert.equal(store.getState().command.selectedBoatId, "typhoon-01");
  assert.deepEqual(store.getState().command.selectedIds, [
    "typhoon-01",
    "typhoon-02",
    "tempest-01",
  ]);
  assert.equal(store.getState().fleet.notice, null);
});

test("runs the guided harbor patrol from selection through intervention", () => {
  const store = makeStore();

  store.dispatch(prepareDemoScenario());
  assert.equal(store.getState().scenario.phase, "READY");
  assert.deepEqual(store.getState().command.selectedIds, [
    "typhoon-01",
    "typhoon-02",
    "tempest-01",
  ]);

  store.dispatch(launchDemoScenario());
  assert.equal(store.getState().scenario.phase, "ACTIVE");
  for (const id of boatIds(store)) {
    assert.equal(store.getState().fleet.fleet.boats[id].mode, "MISSION");
  }

  store.dispatch(injectDemoLinkLoss());
  const isolated = store.getState().fleet.fleet.boats["typhoon-02"];
  assert.equal(store.getState().scenario.phase, "LINK_LOST");
  assert.equal(store.getState().scenario.links["typhoon-02"], "LOST");
  assert.equal(isolated.mode, "HOLD");
  assert.equal(isolated.speedKnots, 0);
  assert.ok(isolated.missionId, "the onboard hold retains the assigned mission");

  store.dispatch(acknowledgeDemoAlert());
  assert.equal(store.getState().scenario.phase, "ACKNOWLEDGED");

  store.dispatch(resolveDemoScenario());
  assert.equal(store.getState().scenario.phase, "RESOLVED");
  assert.deepEqual(store.getState().command.selectedIds, ["typhoon-01", "tempest-01"]);
  assert.equal(store.getState().fleet.fleet.boats["typhoon-02"].mode, "HOLD");
  assert.equal(store.getState().fleet.fleet.boats["typhoon-01"].mode, "MISSION");
  assert.equal(store.getState().fleet.fleet.boats["tempest-01"].mode, "MISSION");

  store.dispatch(resetDemoScenario());
  assert.equal(store.getState().scenario.phase, "BRIEF");
  assert.equal(store.getState().fleet.fleet.boats["typhoon-02"].mode, "IDLE");
});

test("opens and closes the guided workflow without disturbing the fleet", () => {
  const store = makeStore();

  assert.equal(store.getState().scenario.open, false, "the coach starts off the chart");

  store.dispatch(toggleDemoScenario());
  assert.equal(store.getState().scenario.open, true);
  assert.equal(store.getState().scenario.phase, "BRIEF");

  store.dispatch(launchDemoScenario());
  store.dispatch(prepareDemoScenario());
  store.dispatch(launchDemoScenario());
  assert.equal(store.getState().scenario.phase, "ACTIVE");

  // Closing is a view change, so the mission the vessels are flying survives.
  store.dispatch(closeDemoScenario());
  assert.equal(store.getState().scenario.open, false);
  assert.equal(store.getState().scenario.phase, "ACTIVE");
  for (const id of boatIds(store)) {
    assert.equal(store.getState().fleet.fleet.boats[id].mode, "MISSION");
  }

  // Re-opening resumes the same step rather than restarting the script.
  store.dispatch(toggleDemoScenario());
  assert.equal(store.getState().scenario.open, true);
  assert.equal(store.getState().scenario.phase, "ACTIVE");

  // A replay rewinds the scenario and leaves the panel where the operator is
  // reading it.
  store.dispatch(resetDemoScenario());
  assert.equal(store.getState().scenario.phase, "BRIEF");
  assert.equal(store.getState().scenario.open, true);

  store.dispatch(toggleDemoScenario(false));
  assert.equal(store.getState().scenario.open, false);
  // Starting the script from the toolbar-less path still shows the coach.
  store.dispatch(prepareDemoScenario());
  assert.equal(store.getState().scenario.open, true);
});

test("issues the next hull number per class", () => {
  const store = makeStore();

  store.dispatch(boatAdded("TYPHOON", anchorage));
  store.dispatch(boatAdded("TEMPEST", anchorage));

  assert.ok(boatIds(store).includes("typhoon-03"));
  assert.ok(boatIds(store).includes("tempest-02"));
});

test("never re-issues a hull number after a removal", () => {
  const store = makeStore();

  store.dispatch(boatAdded("TEMPEST", anchorage));
  assert.ok(boatIds(store).includes("tempest-02"));

  store.dispatch(removeBoat("tempest-02"));
  store.dispatch(boatAdded("TEMPEST", anchorage));

  assert.ok(boatIds(store).includes("tempest-03"));
  assert.equal(store.getState().fleet.notice, null);
});

test("a rejected order lands in the notice and leaves the fleet untouched", () => {
  const store = makeStore();
  const before = store.getState().fleet.fleet;

  store.dispatch(boatRecalled("missing"));

  assert.match(store.getState().fleet.notice, /Unknown boat ID: missing/);
  assert.equal(store.getState().fleet.fleet, before);
});

test("removing a boat clears it from the selection, the groups and the lead slot", () => {
  const store = makeStore();

  store.dispatch(groupFormed());
  store.dispatch(removeBoat("typhoon-01"));

  const command = store.getState().command;
  assert.equal(command.selectedIds.includes("typhoon-01"), false);
  assert.equal(command.groups[0].boatIds.includes("typhoon-01"), false);
  assert.equal(command.selectedBoatId, "typhoon-02");
});

test("removing the last boat falls back to an empty selection and the fleet view", () => {
  const store = makeStore();

  for (const id of [...boatIds(store)]) store.dispatch(removeBoat(id));

  assert.deepEqual(boatIds(store), []);
  assert.equal(store.getState().command.selectedBoatId, "");
  assert.equal(store.getState().command.view, "FLEET");
});

test("the rudder turns a boat only while it is under manual control", () => {
  const store = makeStore();
  const heading = () => store.getState().fleet.fleet.boats["typhoon-01"].headingDegrees;
  const order = { deltaSeconds: 1, rudder: { boatId: "typhoon-01", degrees: 20 } };

  const before = heading();
  store.dispatch(fleetAdvanced(order));
  assert.equal(heading(), before, "an idle boat ignores the rudder");

  store.dispatch(manualSet({ boatId: "typhoon-01", manual: true }));
  store.dispatch(fleetAdvanced(order));
  assert.notEqual(heading(), before, "a manual boat answers the rudder");
});

test("a tick hands the core a fixed delta scaled by the sim rate", () => {
  const store = makeStore();

  store.dispatch(simRateChanged(4));
  store.dispatch(simulationTicked());

  // TICK_SECONDS (0.1) x rate 4.
  assert.equal(store.getState().telemetry.elapsedSeconds.toFixed(3), "0.400");
});

test("two stores driven by the same orders hold identical fleets", () => {
  const drive = () => {
    const store = makeStore();
    store.dispatch(boatToggled("tempest-01"));
    store.dispatch(routeSelection("PERIMETER"));
    for (let i = 0; i < 25; i += 1) store.dispatch(simulationTicked());
    return store.getState().fleet.fleet;
  };

  assert.deepEqual(drive(), drive());
});

test("a second tasking of the same group does not collide on a mission ID", () => {
  const store = makeStore();
  const order = {
    boatIds: ["typhoon-01"],
    pattern: "PERIMETER",
    center: anchorage,
    radiusNm: 1.5,
    cruiseKnots: 22,
  };

  store.dispatch(fleetRouted(order));
  const first = store.getState().fleet.fleet.boats["typhoon-01"].missionId;

  store.dispatch(fleetRouted(order));
  const second = store.getState().fleet.fleet.boats["typhoon-01"].missionId;

  assert.notEqual(first, second);
  assert.equal(store.getState().fleet.notice, null);
});

test("telemetry samples at a fixed interval rather than every tick", () => {
  const store = makeStore();
  store.dispatch(simRateChanged(1));

  // Ten ticks of 0.1 s is one second, which is two 0.5 s samples.
  for (let i = 0; i < 10; i += 1) store.dispatch(simulationTicked());

  assert.equal(store.getState().telemetry.history["typhoon-01"].length, 2);
});

test("the tick counter is independent of the sim rate, unlike elapsed seconds", () => {
  const drive = (rate) => {
    const store = makeStore();
    store.dispatch(simRateChanged(rate));
    for (let i = 0; i < 20; i += 1) store.dispatch(simulationTicked());
    return store.getState().telemetry;
  };

  const slow = drive(1);
  const fast = drive(16);

  // ForwardView draws the sea from the tick count, so the roll must not speed
  // up when the operator speeds up the clock.
  assert.equal(slow.ticks, fast.ticks);
  assert.ok(fast.elapsedSeconds > slow.elapsedSeconds * 15);
});

test("telemetry is bounded and forgets a boat that has left the fleet", () => {
  const store = makeStore();
  const boats = [{
    id: "typhoon-01",
    position: { latitude: 1, longitude: 2 },
    headingDegrees: 0,
    speedKnots: 0,
    energyPercent: 100,
    mode: "IDLE",
    role: null,
    missionId: null,
    waypointIndex: 0,
  }];

  for (let i = 0; i < 600; i += 1) {
    store.dispatch(telemetrySampled({ deltaSeconds: 0.5, boats }));
  }
  assert.equal(store.getState().telemetry.history["typhoon-01"].length, 240);

  store.dispatch(telemetrySampled({ deltaSeconds: 0.5, boats: [] }));
  assert.equal(store.getState().telemetry.history["typhoon-01"], undefined);
});

test("creating a boat through an order selects it and adds it to the group", () => {
  const store = makeStore();

  store.dispatch(createBoat("TYPHOON"));

  assert.equal(store.getState().command.selectedBoatId, "typhoon-03");
  assert.ok(store.getState().command.selectedIds.includes("typhoon-03"));
});

test("routing with nothing selected is a no-op rather than an error", () => {
  const store = makeStore();

  for (const id of [...boatIds(store)]) store.dispatch(removeBoat(id));
  store.dispatch(routeSelection("PERIMETER"));

  assert.equal(store.getState().fleet.notice, null);
});


test("the telegraph rests at stop, not at the first notch", () => {
  const store = makeStore();

  assert.equal(store.getState().command.throttleNotch, THROTTLE_STOP_INDEX);
  assert.equal(THROTTLE_NOTCHES[THROTTLE_STOP_INDEX], 0);
});

test("helm keys cannot bypass the manual-control confirmation", () => {
  const store = makeStore();
  store.dispatch(takeOver("typhoon-01"));

  store.dispatch(stepThrottle(1));
  let boat = store.getState().fleet.fleet.boats["typhoon-01"];
  assert.equal(boat.mode, "IDLE");
  assert.equal(boat.speedKnots, 0);

  store.dispatch(toggleManual(true));
  store.dispatch(stepThrottle(1));
  boat = store.getState().fleet.fleet.boats["typhoon-01"];
  assert.equal(boat.mode, "MANUAL");
  assert.ok(boat.speedKnots > 0);
});

test("manual control stops before a reported ship's safety bubble", () => {
  const store = makeStore();
  store.dispatch(takeOver("typhoon-01"));
  store.dispatch(toggleManual(true));
  store.dispatch(stepThrottle(1));

  const before = store.getState().fleet.fleet.boats["typhoon-01"].position;
  store.dispatch(contactsReported([{
    mmsi: 123456789,
    name: "Test ship",
    longitude: before.longitude,
    latitude: before.latitude + (30 / 1852 / 60),
    headingDegrees: 0,
    speedKnots: 0,
    kind: "cargo",
    lengthM: 100,
    ageSeconds: 0,
  }]));

  store.dispatch(simulationTicked());
  const held = store.getState().fleet.fleet.boats["typhoon-01"];
  assert.deepEqual(held.position, before);
  assert.equal(held.mode, "MANUAL");
  assert.equal(held.speedKnots, 0);
  assert.deepEqual(store.getState().fleet.safetyAlert, {
    boatId: "typhoon-01",
    hazardId: "mmsi-123456789",
    hazardLabel: "Test ship",
  });
});

test("stepping the telegraph below stop drives the boat astern", () => {
  const store = makeStore();
  store.dispatch(takeOver("typhoon-01"));
  store.dispatch(toggleManual(true));
  store.dispatch(stepThrottle(-1));

  const boat = store.getState().fleet.fleet.boats["typhoon-01"];
  const rated = store.getState().fleet.fleet.definitions["typhoon-01"].maximumSpeedKnots;

  assert.ok(boat.speedKnots < 0, `expected astern, got ${boat.speedKnots}`);
  assert.equal(boat.speedKnots, THROTTLE_NOTCHES[THROTTLE_STOP_INDEX - 1] * rated);
  assert.equal(store.getState().fleet.notice, null, "astern is not a rejected order");
});

test("a boat going astern walks back down its own heading", () => {
  const store = makeStore();
  store.dispatch(takeOver("typhoon-01"));
  store.dispatch(toggleManual(true));

  const before = store.getState().fleet.fleet.boats["typhoon-01"].position;
  store.dispatch(stepThrottle(-1));
  for (let i = 0; i < 20; i += 1) store.dispatch(simulationTicked());

  const boat = store.getState().fleet.fleet.boats["typhoon-01"];
  assert.equal(boat.mode, "MANUAL");
  // Heading is due north at rest, so making sternway must carry it south.
  assert.ok(boat.position.latitude < before.latitude, "it moved astern");
});

test("the telegraph cannot be stepped past either stop", () => {
  const store = makeStore();
  store.dispatch(takeOver("typhoon-01"));
  store.dispatch(toggleManual(true));

  for (let i = 0; i < 12; i += 1) store.dispatch(stepThrottle(1));
  assert.equal(store.getState().command.throttleNotch, THROTTLE_NOTCHES.length - 1);

  for (let i = 0; i < 24; i += 1) store.dispatch(stepThrottle(-1));
  assert.equal(store.getState().command.throttleNotch, 0);
  assert.equal(store.getState().fleet.notice, null);
});

test("the open systems windows are operator intent, not fleet state", () => {
  const store = makeStore();
  const fleetBefore = store.getState().fleet.fleet;

  store.dispatch(subsystemToggled("TURRET"));
  assert.deepEqual(store.getState().command.openSubsystems, ["DRIVE", "TURRET"]);

  // Toggling is a toggle: the same id closes the window it opened.
  store.dispatch(subsystemToggled("DRIVE"));
  assert.deepEqual(store.getState().command.openSubsystems, ["TURRET"]);

  store.dispatch(subsystemsSet([]));
  assert.deepEqual(store.getState().command.openSubsystems, []);

  // Opening a window cannot be allowed to touch the fleet, or a replay would
  // depend on which readout happened to be open.
  assert.equal(store.getState().fleet.fleet, fleetBefore);
});

test("activity reports what the seeded fleet is doing, and follows a tasking", () => {
  const store = makeStore();

  const idle = selectActivity(store.getState());
  assert.equal(idle.total, 3);
  assert.equal(idle.underway, 0);
  assert.equal(idle.tasked, 0);
  assert.ok(idle.entries.every((entry) => entry.kind === "IDLE"));

  store.dispatch(routeSelection("SWEEP"));
  store.dispatch(simulationTicked());

  const tasked = selectActivity(store.getState());
  assert.equal(tasked.tasked, 3);
  assert.ok(tasked.underway > 0, "a routed fleet is making way");
  assert.ok(tasked.effort > 0, "and the measure says so");
  assert.ok(tasked.entries.every((entry) => entry.progress !== null));

  // One cached result per state: a selector that recomputed on every read
  // would re-sort the list under the operator every tick.
  assert.equal(selectActivity(store.getState()), tasked);
});

test("a lost link shows up in activity as a fault, ahead of the healthy hulls", () => {
  const store = makeStore();

  store.dispatch(prepareDemoScenario());
  store.dispatch(launchDemoScenario());
  store.dispatch(injectDemoLinkLoss());

  const activity = selectActivity(store.getState());
  const affected = store.getState().scenario.affectedBoatId;

  assert.equal(activity.faults, 1);
  assert.equal(activity.entries[0].boatId, affected);
  assert.equal(activity.entries[0].kind, "FAULT");
  assert.equal(activity.entries[0].speedKnots, 0, "the hull is stopped onboard");
});
