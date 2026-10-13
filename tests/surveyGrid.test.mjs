import assert from "node:assert/strict";
import test from "node:test";

import {
  boundsOf,
  cellAt,
  cellsWithin,
  centreOf,
  keyAt,
  keyOf,
  cellOfKey,
  ringOf,
  rowHeightDegrees,
} from "../app/core/surveyGrid.ts";

const SIZE = 0.5;
const HARBOUR = { latitude: 33.718, longitude: -118.26 };

test("a position always lands inside the cell it addresses", () => {
  const cell = cellAt(HARBOUR, SIZE);
  const bounds = boundsOf(cell, SIZE);

  assert.ok(HARBOUR.latitude >= bounds.south && HARBOUR.latitude < bounds.north);
  assert.ok(HARBOUR.longitude >= bounds.west && HARBOUR.longitude < bounds.east);
});

test("a cell is half a mile tall, which is what was asked for", () => {
  const bounds = boundsOf(cellAt(HARBOUR, SIZE), SIZE);
  const heightNm = (bounds.north - bounds.south) * 60;

  assert.ok(Math.abs(heightNm - SIZE) < 1e-9, `got ${heightNm}`);
});

test("columns widen with latitude so a cell stays roughly square", () => {
  const width = (position) => {
    const b = boundsOf(cellAt(position, SIZE), SIZE);
    // Degrees of longitude are shorter than degrees of latitude away from the
    // equator, so the cell has to span more of them to cover the same water.
    return (b.east - b.west) * 60 * Math.cos((position.latitude * Math.PI) / 180);
  };

  for (const latitude of [0.3, 33.7, 60.2]) {
    const onWater = width({ latitude, longitude: -118.26 });
    assert.ok(Math.abs(onWater - SIZE) < SIZE * 0.02, `at ${latitude}: ${onWater}`);
  }
});

test("addresses survive a round trip through their key", () => {
  const cell = cellAt(HARBOUR, SIZE);

  assert.deepEqual(cellOfKey(keyOf(cell)), cell);
  assert.equal(keyAt(HARBOUR, SIZE), keyOf(cell));
});

test("the same water keeps the same address whatever the viewport", () => {
  const nudged = { latitude: HARBOUR.latitude + 1e-7, longitude: HARBOUR.longitude - 1e-7 };

  assert.equal(keyAt(HARBOUR, SIZE), keyAt(nudged, SIZE));
});

test("neighbouring water lands in a neighbouring cell, not the same one", () => {
  const north = { latitude: HARBOUR.latitude + rowHeightDegrees(SIZE), longitude: HARBOUR.longitude };

  assert.notEqual(keyAt(HARBOUR, SIZE), keyAt(north, SIZE));
  assert.equal(cellAt(north, SIZE).row, cellAt(HARBOUR, SIZE).row + 1);
});

test("a ring closes and a centre sits inside its own cell", () => {
  const cell = cellAt(HARBOUR, SIZE);
  const ring = ringOf(cell, SIZE);

  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4], "the ring closes");
  assert.equal(keyAt(centreOf(cell, SIZE), SIZE), keyOf(cell));
});

test("covering a box returns every cell that overlaps it", () => {
  const bounds = { west: -118.27, east: -118.25, south: 33.71, north: 33.73 };
  const cells = cellsWithin(bounds, SIZE);

  assert.ok(cells.length > 0);
  assert.ok(cells.some((cell) => keyOf(cell) === keyAt(HARBOUR, SIZE)), "includes the harbour cell");

  for (const cell of cells) {
    const b = boundsOf(cell, SIZE);
    assert.ok(b.east > bounds.west && b.west < bounds.east, "overlaps in longitude");
    assert.ok(b.north > bounds.south && b.south < bounds.north, "overlaps in latitude");
  }
});

test("an absurd box returns nothing rather than a truncated grid", () => {
  const whole = { west: -180, east: 180, south: -85, north: 85 };

  assert.deepEqual(cellsWithin(whole, SIZE), [], "a silent truncation would read as coverage");
});
