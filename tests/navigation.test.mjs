import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  advanceAlongHeading,
  bearingBetween,
  distanceBetween,
  moveToward,
} from "../app/core/navigation.ts";

function assertClose(actual, expected, tolerance = 0.01) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

describe("distanceBetween", () => {
  test("returns nautical miles and leaves its inputs unchanged", () => {
    const start = { latitude: 0, longitude: 0 };
    const destination = { latitude: 1, longitude: 0 };
    const originalStart = structuredClone(start);
    const originalDestination = structuredClone(destination);

    assertClose(distanceBetween(start, destination), 60.04, 0.02);
    assert.deepEqual(start, originalStart);
    assert.deepEqual(destination, originalDestination);
  });

  test("uses the short path across the antimeridian", () => {
    const distance = distanceBetween(
      { latitude: 0, longitude: 179.5 },
      { latitude: 0, longitude: -179.5 },
    );

    assertClose(distance, 60.04, 0.02);
  });
});

describe("bearingBetween", () => {
  test("returns normalized cardinal bearings", () => {
    assertClose(
      bearingBetween(
        { latitude: 0, longitude: 0 },
        { latitude: 1, longitude: 0 },
      ),
      0,
    );
    assertClose(
      bearingBetween(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 1 },
      ),
      90,
    );
  });

  test("returns zero when start and destination are identical", () => {
    assert.equal(
      bearingBetween(
        { latitude: 33.728, longitude: -118.255 },
        { latitude: 33.728, longitude: -118.255 },
      ),
      0,
    );
  });
});

describe("moveToward", () => {
  test("moves a requested distance toward the destination", () => {
    const start = { latitude: 0, longitude: 0 };
    const destination = { latitude: 1, longitude: 0 };
    const halfwayDistance = distanceBetween(start, destination) / 2;
    const result = moveToward(start, destination, halfwayDistance);

    assertClose(result.latitude, 0.5, 0.000001);
    assertClose(result.longitude, 0, 0.000001);
  });

  test("lands exactly on the destination instead of overshooting", () => {
    const start = { latitude: 33.728, longitude: -118.255 };
    const destination = { latitude: 33.735, longitude: -118.24 };
    const result = moveToward(
      start,
      destination,
      distanceBetween(start, destination) + 10,
    );

    assert.deepEqual(result, destination);
    assert.notEqual(result, destination);
  });

  test("crosses the antimeridian on the short path", () => {
    const start = { latitude: 0, longitude: 179.5 };
    const destination = { latitude: 0, longitude: -179.5 };
    const result = moveToward(
      start,
      destination,
      distanceBetween(start, destination) / 2,
    );

    assertClose(Math.abs(result.longitude), 180, 0.000001);
  });

  test("rejects invalid movement distances", () => {
    const start = { latitude: 0, longitude: 0 };
    const destination = { latitude: 1, longitude: 0 };

    assert.throws(
      () => moveToward(start, destination, -1),
      /Movement distance must be a non-negative finite number/,
    );
    assert.throws(
      () => moveToward(start, destination, Number.NaN),
      /Movement distance must be a non-negative finite number/,
    );
  });
});

describe("advanceAlongHeading", () => {
  test("walks the requested distance on the requested course", () => {
    const start = { latitude: 33.74, longitude: -118.25 };
    const moved = advanceAlongHeading(start, 90, 12);

    assertClose(distanceBetween(start, moved), 12, 1e-6);
    assertClose(bearingBetween(start, moved), 90, 0.05);
    assert.deepEqual(start, { latitude: 33.74, longitude: -118.25 });
  });

  test("returns the start for zero distance and rejects invalid input", () => {
    const start = { latitude: 10, longitude: 20 };

    assert.deepEqual(advanceAlongHeading(start, 45, 0), start);
    assert.notEqual(advanceAlongHeading(start, 45, 0), start);
    assert.throws(() => advanceAlongHeading(start, Number.NaN, 1), /Heading/);
    assert.throws(() => advanceAlongHeading(start, 45, -1), /non-negative/);
  });
});
