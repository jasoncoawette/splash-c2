import assert from "node:assert/strict";
import test from "node:test";

import { HULL_LENGTH_M, SAFETY_MARGIN_M, hullRadiusNm } from "../app/core/hull.ts";
import { advanceAlongHeading, distanceBetween } from "../app/core/navigation.ts";
import { clampToWater, isLand, isNavigable, wasBlocked } from "../app/core/seaRoom.ts";
import { clampToTraffic, separateHulls } from "../app/core/separation.ts";

// Confirmed against the Mapbox Streets water layer when the anchorages were
// chosen; see REQUIREMENTS.md, "Seed vessels in open water".
const OPEN_WATER = { latitude: 33.7055, longitude: -118.236 };
const MORE_WATER = { latitude: 33.7155, longitude: -118.193 };
const TERMINAL_ISLAND = { latitude: 33.751, longitude: -118.252 };

const METRES_PER_NM = 1852;

test("knows open water from Terminal Island", () => {
  assert.equal(isLand(OPEN_WATER), false);
  assert.equal(isNavigable(OPEN_WATER), true);
  assert.equal(isLand(TERMINAL_ISLAND), true);
  assert.equal(isNavigable(TERMINAL_ISLAND), false);
});

test("treats anything outside the mask as open water rather than land", () => {
  assert.equal(isLand({ latitude: 0, longitude: 0 }), false);
  assert.equal(isLand({ latitude: 48.9, longitude: -124.5 }), false);
});

test("stops a track at the water's edge instead of crossing land", () => {
  const allowed = clampToWater(OPEN_WATER, TERMINAL_ISLAND);

  assert.equal(isNavigable(allowed), true, "the boat is left in water");
  assert.equal(wasBlocked(TERMINAL_ISLAND, allowed), true, "the move was cut short");
  assert.ok(
    distanceBetween(OPEN_WATER, allowed) < distanceBetween(OPEN_WATER, TERMINAL_ISLAND),
    "it stopped short of the shore",
  );
});

test("leaves a track that stays in water untouched", () => {
  const allowed = clampToWater(OPEN_WATER, MORE_WATER);

  assert.equal(wasBlocked(MORE_WATER, allowed), false);
  assert.deepEqual(allowed, MORE_WATER);
});

test("will not let a long step jump clean over a headland", () => {
  // A single tick that spans the island: the endpoint is water on the far side,
  // so only walking the track catches the crossing.
  const farSide = { latitude: 33.775, longitude: -118.252 };
  const allowed = clampToWater(OPEN_WATER, farSide);

  assert.equal(isNavigable(allowed), true);
  assert.equal(wasBlocked(farSide, allowed), true, "the crossing was refused");
});

test("a boat already ashore is not imprisoned by the mask", () => {
  const allowed = clampToWater(TERMINAL_ISLAND, OPEN_WATER);

  assert.deepEqual(allowed, OPEN_WATER, "it may always move back to water");
});

test("pushes two overlapping hulls apart to their safety margin", () => {
  const radiusNm = hullRadiusNm("TYPHOON");
  const moved = separateHulls([
    { id: "a", position: OPEN_WATER, radiusNm },
    { id: "b", position: { ...OPEN_WATER }, radiusNm },
  ]);

  const gapM = distanceBetween(moved.get("a"), moved.get("b")) * METRES_PER_NM;
  const required = HULL_LENGTH_M.TYPHOON + SAFETY_MARGIN_M;

  assert.ok(gapM > 0, "two hulls in the same spot do not stay welded together");
  assert.ok(gapM >= required * 0.9, `expected about ${required} m apart, got ${gapM.toFixed(1)}`);
});

test("leaves hulls that are already clear where they are", () => {
  const radiusNm = hullRadiusNm("TEMPEST");
  const hulls = [
    { id: "a", position: OPEN_WATER, radiusNm },
    { id: "b", position: MORE_WATER, radiusNm },
  ];
  const moved = separateHulls(hulls);

  assert.deepEqual(moved.get("a"), OPEN_WATER);
  assert.deepEqual(moved.get("b"), MORE_WATER);
});

test("stops a track before it enters a reported ship's safety bubble", () => {
  const ship = advanceAlongHeading(OPEN_WATER, 90, 0.08);
  const requested = advanceAlongHeading(OPEN_WATER, 90, 0.16);
  const allowed = clampToTraffic(
    OPEN_WATER,
    requested,
    hullRadiusNm("TYPHOON"),
    [{ id: "mmsi-1", position: ship, radiusNm: 100 / 2 / METRES_PER_NM }],
  );

  assert.ok(
    distanceBetween(OPEN_WATER, allowed) < distanceBetween(OPEN_WATER, requested),
    "the track was cut short",
  );
  assert.ok(
    distanceBetween(allowed, ship) * METRES_PER_NM >= 25 + 50,
    "the boat held outside the ship and safety margin",
  );
});

test("a late traffic report does not imprison a boat that is moving away", () => {
  const ship = advanceAlongHeading(OPEN_WATER, 90, 0.005);
  const escape = advanceAlongHeading(OPEN_WATER, 270, 0.05);
  const allowed = clampToTraffic(
    OPEN_WATER,
    escape,
    hullRadiusNm("TYPHOON"),
    [{ id: "mmsi-2", position: ship, radiusNm: 100 / 2 / METRES_PER_NM }],
  );

  assert.deepEqual(allowed, escape);
});

test("separates the same crowd identically whatever order it arrives in", () => {
  const radiusNm = hullRadiusNm("TYPHOON");
  const near = (index) => ({
    latitude: OPEN_WATER.latitude + index * 0.00004,
    longitude: OPEN_WATER.longitude,
  });
  const hulls = ["a", "b", "c", "d"].map((id, index) => ({
    id,
    position: near(index),
    radiusNm,
  }));

  const forwards = separateHulls(hulls);
  const backwards = separateHulls([...hulls].reverse());

  for (const id of ["a", "b", "c", "d"]) {
    assert.deepEqual(forwards.get(id), backwards.get(id), `${id} settled the same way`);
  }
});
