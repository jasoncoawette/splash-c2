import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FOLLOW_MODES, planFollow } from "../app/core/followTarget.ts";
import { bearingBetween, distanceBetween } from "../app/core/navigation.ts";
import {
  createFleet,
  followFleetTarget,
  retargetMission,
  stepFleet,
} from "../app/simulator/fleet.ts";

const target = { latitude: 33.712, longitude: -118.229 };

const seeds = [
  {
    definition: {
      id: "typhoon-01",
      name: "Typhoon One",
      type: "TYPHOON",
      maximumSpeedKnots: 45,
      maximumRangeNm: 400,
    },
    position: { latitude: 33.72, longitude: -118.24 },
  },
  {
    definition: {
      id: "typhoon-02",
      name: "Typhoon Two",
      type: "TYPHOON",
      maximumSpeedKnots: 45,
      maximumRangeNm: 400,
    },
    position: { latitude: 33.705, longitude: -118.22 },
  },
];

function order(overrides = {}) {
  return {
    boatIds: ["typhoon-01", "typhoon-02"],
    mode: "ESCORT",
    target,
    targetHeadingDegrees: 90,
    standoffNm: 0.35,
    cruiseKnots: 24,
    sequence: 1,
    ...overrides,
  };
}

describe("planFollow", () => {
  test("plans one station at the standoff distance for every mode", () => {
    for (const spec of FOLLOW_MODES) {
      const mission = planFollow({
        missionId: `${spec.mode}-1`,
        mode: spec.mode,
        target,
        targetHeadingDegrees: 45,
        slot: 0,
        groupSize: 2,
        standoffNm: spec.standoffNm,
      });

      assert.equal(mission.role, spec.role);
      assert.equal(mission.waypoints.length, 1, `${spec.mode} holds one station`);
      assert.equal(
        mission.objective.kind,
        spec.mode === "ESCORT" ? "ESCORT_TARGET" : "MONITOR_TARGET",
      );
      assert.ok(
        Math.abs(distanceBetween(target, mission.waypoints[0]) - spec.standoffNm) < 1e-6,
        `${spec.mode} sits at its standoff`,
      );
    }
  });

  test("gives each boat its own station and moves them with the target's course", () => {
    const base = {
      missionId: "escort-1",
      mode: "ESCORT",
      target,
      targetHeadingDegrees: 0,
      groupSize: 2,
      standoffNm: 0.4,
    };
    const port = planFollow({ ...base, slot: 0 });
    const starboard = planFollow({ ...base, slot: 1 });

    assert.notDeepEqual(port.waypoints[0], starboard.waypoints[0]);
    // The screen is carried round with the contact rather than held in the world.
    const turned = planFollow({ ...base, slot: 0, targetHeadingDegrees: 90 });
    const beforeBearing = bearingBetween(target, port.waypoints[0]);
    const afterBearing = bearingBetween(target, turned.waypoints[0]);
    assert.ok(Math.abs(((afterBearing - beforeBearing + 540) % 360) - 180 - 90) < 1);
  });

  test("monitor ignores the contact's course and spreads around the ring", () => {
    const base = {
      missionId: "monitor-1",
      mode: "MONITOR",
      target,
      slot: 0,
      groupSize: 4,
      standoffNm: 1.1,
    };

    assert.deepEqual(
      planFollow({ ...base, targetHeadingDegrees: 0 }),
      planFollow({ ...base, targetHeadingDegrees: 270 }),
    );
    assert.ok(
      Math.abs(bearingBetween(
        target,
        planFollow({ ...base, slot: 1, targetHeadingDegrees: 0 }).waypoints[0],
      ) - 90) < 1,
    );
  });

  test("rejects a slot outside the group and a standoff of zero", () => {
    const base = {
      missionId: "escort-1",
      mode: "ESCORT",
      target,
      targetHeadingDegrees: 0,
      slot: 0,
      groupSize: 2,
      standoffNm: 0.4,
    };

    assert.throws(() => planFollow({ ...base, slot: 2 }), /inside the tasked group/);
    assert.throws(() => planFollow({ ...base, standoffNm: 0 }), /greater than zero/);
    assert.throws(() => planFollow({ ...base, mode: "SHADOW" }), /Unknown follow mode/);
  });
});

describe("followFleetTarget", () => {
  test("tasks a group onto a contact at cruise speed", () => {
    const fleet = followFleetTarget(createFleet(seeds), order());

    for (const boatId of ["typhoon-01", "typhoon-02"]) {
      assert.equal(fleet.boats[boatId].mode, "MISSION");
      assert.equal(fleet.boats[boatId].role, "PATROL");
      assert.equal(fleet.boats[boatId].speedKnots, 24);
    }

    assert.deepEqual(Object.keys(fleet.missions).sort(), ["escort-1-0", "escort-1-1"]);
  });

  test("re-tasking the same group onto a contact does not collide", () => {
    const first = followFleetTarget(createFleet(seeds), order());
    const second = followFleetTarget(first, order({ mode: "MONITOR", sequence: 2 }));

    assert.equal(Object.keys(second.missions).length, 2);
    assert.equal(second.boats["typhoon-01"].role, "RECON");
  });
});

describe("retargetMission", () => {
  test("moves the station without re-issuing the mission or dropping the boat", () => {
    const fleet = followFleetTarget(createFleet(seeds), order());
    const moved = { latitude: 33.716, longitude: -118.215 };
    const replanned = planFollow({
      missionId: "escort-1-0",
      mode: "ESCORT",
      target: moved,
      targetHeadingDegrees: 90,
      slot: 0,
      groupSize: 2,
      standoffNm: 0.35,
    });
    const next = retargetMission(fleet, replanned);

    assert.equal(next.boats["typhoon-01"].mode, "MISSION");
    assert.equal(next.boats["typhoon-01"].missionId, "escort-1-0");
    assert.equal(next.boats["typhoon-01"].waypointIndex, 0);
    assert.deepEqual(next.missions["escort-1-0"].waypoints, replanned.waypoints);
    assert.notDeepEqual(
      next.missions["escort-1-0"].waypoints,
      fleet.missions["escort-1-0"].waypoints,
    );
    // The other boat's mission is untouched.
    assert.deepEqual(next.missions["escort-1-1"], fleet.missions["escort-1-1"]);
    assert.deepEqual(fleet.boats["typhoon-01"].position, next.boats["typhoon-01"].position);
  });

  test("a boat chasing a running contact closes on its station", () => {
    let fleet = followFleetTarget(createFleet(seeds), order());
    let contact = target;

    for (let tick = 0; tick < 40; tick += 1) {
      fleet = stepFleet(fleet, 10);
      contact = { latitude: contact.latitude, longitude: contact.longitude + 0.0004 };
      fleet = retargetMission(fleet, planFollow({
        missionId: "escort-1-0",
        mode: "ESCORT",
        target: contact,
        targetHeadingDegrees: 90,
        slot: 0,
        groupSize: 2,
        standoffNm: 0.35,
      }));
    }

    const gap = distanceBetween(fleet.boats["typhoon-01"].position, contact);
    assert.ok(gap < 1.2, `expected the escort to close on the contact, gap was ${gap}`);
    assert.equal(fleet.boats["typhoon-01"].mode, "MISSION");
  });

  test("parks at a stopped contact and automatically resumes when it moves", () => {
    let fleet = followFleetTarget(createFleet(seeds), order({ boatIds: ["typhoon-01"] }));
    const missionId = fleet.boats["typhoon-01"].missionId;
    const station = fleet.missions[missionId].waypoints[0];

    // One large deterministic step reaches the station. The assignment stays
    // live, but the reported vessel speed is truly stopped.
    fleet = stepFleet(fleet, 60 * 60);
    assert.deepEqual(fleet.boats["typhoon-01"].position, station);
    assert.equal(fleet.boats["typhoon-01"].mode, "MISSION");
    assert.equal(fleet.boats["typhoon-01"].speedKnots, 0);

    // Re-reporting the same contact does not wake the parked escort.
    fleet = retargetMission(fleet, planFollow({
      missionId,
      mode: "ESCORT",
      target,
      targetHeadingDegrees: 90,
      slot: 0,
      groupSize: 1,
      standoffNm: 0.35,
    }));
    assert.equal(fleet.boats["typhoon-01"].speedKnots, 0);

    // Once the live station changes, the stored cruise order wakes it again.
    fleet = retargetMission(fleet, planFollow({
      missionId,
      mode: "ESCORT",
      target: { ...target, longitude: target.longitude + 0.01 },
      targetHeadingDegrees: 90,
      slot: 0,
      groupSize: 1,
      standoffNm: 0.35,
    }));
    assert.equal(fleet.boats["typhoon-01"].speedKnots, 24);
  });

  test("rejects an unknown mission and a change of role", () => {
    const fleet = followFleetTarget(createFleet(seeds), order());
    const mission = fleet.missions["escort-1-0"];

    assert.throws(
      () => retargetMission(fleet, { ...mission, id: "ghost-1" }),
      /Unknown mission ID/,
    );
    assert.throws(
      () => retargetMission(fleet, { ...mission, role: "RECON" }),
      /must not change a mission's role/,
    );
  });
});
