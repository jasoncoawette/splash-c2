import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { distanceBetween } from "../app/core/navigation.ts";
import { crossesLand, isLand } from "../app/core/seaRoom.ts";
import { MISSION_PATTERNS, planMission } from "../app/core/missionPlanner.ts";
import {
  createFleet,
  recallBoat,
  routeFleet,
  setBoatThrottle,
  setManualControl,
  steerBoat,
  stepFleet,
} from "../app/simulator/fleet.ts";

const center = { latitude: 33.74, longitude: -118.25 };

const seeds = [
  {
    definition: {
      id: "typhoon-01",
      name: "Typhoon One",
      type: "TYPHOON",
      maximumSpeedKnots: 45,
      maximumRangeNm: 400,
    },
    position: { latitude: 33.744, longitude: -118.267 },
  },
  {
    definition: {
      id: "typhoon-02",
      name: "Typhoon Two",
      type: "TYPHOON",
      maximumSpeedKnots: 45,
      maximumRangeNm: 400,
    },
    position: { latitude: 33.733, longitude: -118.241 },
  },
  {
    definition: {
      id: "tempest-01",
      name: "Tempest One",
      type: "TEMPEST",
      maximumSpeedKnots: 38,
      maximumRangeNm: 900,
    },
    position: { latitude: 33.751, longitude: -118.252 },
  },
];

const groupIds = ["typhoon-01", "typhoon-02"];

function order(overrides = {}) {
  return {
    boatIds: groupIds,
    pattern: "PERIMETER",
    center,
    radiusNm: 1.5,
    cruiseKnots: 22,
    sequence: 1,
    ...overrides,
  };
}

describe("planMission", () => {
  test("plans every pattern inside the tasked radius with the pattern's role", () => {
    for (const spec of MISSION_PATTERNS) {
      const mission = planMission({
        missionId: `${spec.pattern}-1`,
        pattern: spec.pattern,
        center,
        slot: 0,
        groupSize: 2,
        radiusNm: 1.5,
      });

      assert.equal(mission.role, spec.role);
      assert.ok(mission.waypoints.length >= 1, `${spec.pattern} needs a waypoint`);
      assert.ok(mission.objective, `${spec.pattern} needs a defined objective`);

      for (const waypoint of mission.waypoints) {
        assert.ok(
          distanceBetween(center, waypoint) <= 1.5 * 3,
          `${spec.pattern} waypoint escaped the tasked box`,
        );
      }
    }
  });

  test("gives each slot in a group its own route", () => {
    const input = {
      missionId: "perimeter-1",
      pattern: "PERIMETER",
      center,
      groupSize: 3,
      radiusNm: 2,
    };
    const first = planMission({ ...input, slot: 0 });
    const second = planMission({ ...input, slot: 1 });

    assert.notDeepEqual(first.waypoints[0], second.waypoints[0]);
  });

  test("replans identically from identical input", () => {
    const input = {
      missionId: "sweep-7",
      pattern: "SWEEP",
      center,
      slot: 1,
      groupSize: 3,
      radiusNm: 2,
    };

    assert.deepEqual(planMission(input), planMission(input));
  });

  test("rejects a slot outside the group and a radius of zero", () => {
    const input = {
      missionId: "sweep-7",
      pattern: "SWEEP",
      center,
      slot: 0,
      groupSize: 2,
      radiusNm: 2,
    };

    assert.throws(() => planMission({ ...input, slot: 2 }), /inside the tasked group/);
    assert.throws(() => planMission({ ...input, radiusNm: 0 }), /greater than zero/);
  });
});

describe("routeFleet", () => {
  test("tasks a whole group and leaves the untasked boat idle", () => {
    const fleet = createFleet(seeds);
    const routed = routeFleet(fleet, order());

    for (const boatId of groupIds) {
      assert.equal(routed.boats[boatId].mode, "MISSION");
      assert.equal(routed.boats[boatId].role, "PATROL");
      assert.equal(routed.boats[boatId].speedKnots, 22);
    }

    assert.equal(Object.keys(routed.missions).length, 2);
    assert.equal(routed.boats["tempest-01"].mode, "IDLE");
    assert.equal(fleet.boats["typhoon-01"].mode, "IDLE");
  });

  test("re-routes a group that is already running", () => {
    const routed = routeFleet(createFleet(seeds), order());
    const rerouted = routeFleet(routed, order({ pattern: "SWEEP", sequence: 2 }));

    assert.equal(Object.keys(rerouted.missions).length, 2);
    assert.equal(rerouted.boats["typhoon-01"].role, "RECON");
    assert.deepEqual(
      Object.keys(rerouted.missions).sort(),
      ["sweep-2-0", "sweep-2-1"],
    );
  });

  test("runs each boat at its own rating and rejects a duplicate boat", () => {
    const fleet = createFleet(seeds);
    // A group order names one cruise speed; a mixed group does not share one
    // rating, so the order must not fail on the slowest hull.
    const fast = routeFleet(fleet, order({
      boatIds: ["typhoon-01", "tempest-01"],
      cruiseKnots: 500,
    }));

    assert.equal(fast.boats["typhoon-01"].speedKnots, 45);
    assert.equal(fast.boats["tempest-01"].speedKnots, 38);
    assert.throws(
      () => routeFleet(fleet, order({ boatIds: ["typhoon-01", "typhoon-01"] })),
      /Duplicate boat ID in route order/,
    );
    assert.throws(() => routeFleet(fleet, order({ boatIds: [] })), /at least one boat/);
  });

  test("moves a routed group deterministically", () => {
    const routed = routeFleet(createFleet(seeds), order());

    assert.deepEqual(stepFleet(routed, 60), stepFleet(routed, 60));
    assert.notDeepEqual(
      stepFleet(routed, 60).boats["typhoon-01"].position,
      routed.boats["typhoon-01"].position,
    );
    assert.deepEqual(
      stepFleet(routed, 60).boats["tempest-01"],
      routed.boats["tempest-01"],
    );
  });
});

describe("helm control", () => {
  test("takes the helm, steers, and hands the route back", () => {
    const routed = routeFleet(createFleet(seeds), order());
    const manual = steerBoat(
      setBoatThrottle(setManualControl(routed, "typhoon-01", true), "typhoon-01", 30),
      "typhoon-01",
      -90,
    );

    assert.equal(manual.boats["typhoon-01"].mode, "MANUAL");
    assert.equal(manual.boats["typhoon-01"].headingDegrees, 270);
    assert.equal(manual.boats["typhoon-01"].missionId, "perimeter-1-0");

    const steamed = stepFleet(manual, 60);
    assert.equal(steamed.boats["typhoon-01"].waypointIndex, 0);
    assert.ok(
      distanceBetween(
        manual.boats["typhoon-01"].position,
        steamed.boats["typhoon-01"].position,
      ) > 0,
    );

    const released = setManualControl(steamed, "typhoon-01", false);
    assert.equal(released.boats["typhoon-01"].mode, "MISSION");
    assert.equal(released.boats["typhoon-01"].missionId, "perimeter-1-0");
  });

  test("returns an untasked boat to idle when the helm is handed back", () => {
    const fleet = setManualControl(createFleet(seeds), "tempest-01", true);

    assert.equal(fleet.boats["tempest-01"].mode, "MANUAL");
    assert.equal(setManualControl(fleet, "tempest-01", false).boats["tempest-01"].mode, "IDLE");
  });

  test("recalls a boat and frees its mission for re-tasking", () => {
    const routed = routeFleet(createFleet(seeds), order());
    const recalled = recallBoat(routed, "typhoon-01");

    assert.equal(recalled.boats["typhoon-01"].mode, "IDLE");
    assert.equal(recalled.boats["typhoon-01"].missionId, null);
    assert.equal(recalled.boats["typhoon-01"].speedKnots, 0);
    assert.deepEqual(Object.keys(recalled.missions), ["perimeter-1-1"]);
    assert.equal(routed.boats["typhoon-01"].mode, "MISSION");
  });

  test("rejects unknown boats and impossible helm demands", () => {
    const fleet = createFleet(seeds);

    assert.throws(() => setBoatThrottle(fleet, "ghost-01", 10), /Unknown boat ID/);
    assert.throws(() => setBoatThrottle(fleet, "typhoon-01", Number.NaN), /finite/);
    assert.throws(() => steerBoat(fleet, "typhoon-01", Number.NaN), /finite/);

    // Astern is an order, not an impossible demand, and the rating bounds it
    // in both directions rather than only ahead.
    assert.equal(setBoatThrottle(fleet, "typhoon-01", -12).boats["typhoon-01"].speedKnots, -12);
    assert.equal(setBoatThrottle(fleet, "typhoon-01", -500).boats["typhoon-01"].speedKnots, -45);
  });
});

describe("looping patrols", () => {
  test("a perimeter runs its circuit instead of finishing at the last corner", () => {
    const routed = routeFleet(createFleet(seeds), order({ pattern: "PERIMETER" }));
    let fleet = routed;

    // Far more time than one lap needs, at a speed that outruns the ring.
    for (let step = 0; step < 60; step += 1) fleet = stepFleet(fleet, 60);

    assert.equal(fleet.boats["typhoon-01"].mode, "MISSION");
    assert.equal(fleet.boats["typhoon-01"].missionId, "perimeter-1-0");
    assert.ok(fleet.missions["perimeter-1-0"].loop);
  });

  test("a transit still completes and holds", () => {
    let fleet = routeFleet(createFleet(seeds), order({ pattern: "TRANSIT" }));

    for (let step = 0; step < 60; step += 1) fleet = stepFleet(fleet, 60);

    assert.equal(fleet.boats["typhoon-01"].mode, "HOLD");
    assert.equal(fleet.boats["typhoon-01"].missionId, null);
    assert.equal(fleet.boats["typhoon-01"].speedKnots, 0);
  });
});

describe("keeping off the land", () => {
  // An objective in the middle of the harbour: a ring round it crosses
  // Terminal Island, the moles and half the Port of Los Angeles.
  const harbour = { latitude: 33.74, longitude: -118.25 };

  test("plans no waypoint ashore and no leg across land", () => {
    for (const spec of MISSION_PATTERNS) {
      for (let slot = 0; slot < 3; slot += 1) {
        const mission = planMission({
          missionId: `${spec.pattern}-${slot}`,
          pattern: spec.pattern,
          center: harbour,
          slot,
          groupSize: 3,
          radiusNm: 1.5,
        });

        for (const waypoint of mission.waypoints) {
          assert.equal(
            isLand(waypoint),
            false,
            `${spec.pattern} slot ${slot} planned a waypoint ashore`,
          );
        }

        for (let leg = 1; leg < mission.waypoints.length; leg += 1) {
          assert.equal(
            crossesLand(mission.waypoints[leg - 1], mission.waypoints[leg]),
            false,
            `${spec.pattern} slot ${slot} planned leg ${leg} across land`,
          );
        }

        // A circuit also has to get home without crossing anything.
        if (mission.loop && mission.waypoints.length > 1) {
          assert.equal(
            crossesLand(mission.waypoints.at(-1), mission.waypoints[0]),
            false,
            `${spec.pattern} slot ${slot} closed its circuit across land`,
          );
        }
      }
    }
  });

  test("routes the run in from where a hull actually sits", () => {
    const fleet = routeFleet(createFleet(seeds), order({ center: harbour }));

    for (const boatId of Object.keys(fleet.boats)) {
      const boat = fleet.boats[boatId];
      const mission = fleet.missions[boat.missionId];

      // One seed sits on Terminal Island, and a hull already ashore has no
      // clean leg to offer — the rule is about not driving onto land, not
      // about rescuing a boat that started on it.
      if (!mission || isLand(boat.position)) continue;

      assert.equal(
        crossesLand(boat.position, mission.waypoints[0]),
        false,
        `${boatId} was sent in across land`,
      );
    }
  });

  test("never grounds a boat, and never parks one against the shore", () => {
    const routed = routeFleet(createFleet(seeds), order({ center: harbour }));
    // One seed sits on Terminal Island. It was never tasked, so it is still
    // there at the end — what matters is that nothing afloat joins it.
    const afloat = Object.keys(routed.boats)
      .filter((boatId) => !isLand(routed.boats[boatId].position));
    let fleet = routed;

    assert.ok(afloat.length > 0, "the fixture needs a boat in the water");

    // An hour of sim time: long enough for several laps of the ring.
    for (let step = 0; step < 240; step += 1) fleet = stepFleet(fleet, 15);

    for (const boatId of afloat) {
      const boat = fleet.boats[boatId];

      assert.equal(isLand(boat.position), false, `${boatId} ran aground`);

      if (boat.mode === "MISSION") {
        assert.notEqual(
          boat.speedKnots,
          0,
          `${boatId} stalled under way instead of working round the land`,
        );
      }
    }
  });
});
