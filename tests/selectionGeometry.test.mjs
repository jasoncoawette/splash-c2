import assert from "node:assert/strict";
import test from "node:test";

import {
  averagePosition,
  centroidOf,
  containsPoint,
  exceedsDragThreshold,
  mergeSelection,
  pointsInside,
  rectangleBetween,
} from "../app/components/map/selectionGeometry.ts";

test("a marquee drawn from any corner normalises to a positive box", () => {
  const dragged = rectangleBetween({ x: 120, y: 90 }, { x: 40, y: 20 });

  assert.deepEqual(dragged, { left: 40, top: 20, width: 80, height: 70 });
  assert.deepEqual(rectangleBetween({ x: 40, y: 20 }, { x: 120, y: 90 }), dragged);
});

test("the marquee catches boats inside it and on its edge", () => {
  const rectangle = rectangleBetween({ x: 10, y: 10 }, { x: 50, y: 50 });

  assert.equal(containsPoint(rectangle, { x: 30, y: 30 }), true);
  assert.equal(containsPoint(rectangle, { x: 10, y: 50 }), true);
  assert.equal(containsPoint(rectangle, { x: 51, y: 30 }), false);
  assert.deepEqual(
    pointsInside(
      [
        { id: "typhoon-01", x: 12, y: 12 },
        { id: "typhoon-02", x: 80, y: 30 },
        { id: "tempest-01", x: 50, y: 49 },
      ],
      rectangle,
    ),
    ["typhoon-01", "tempest-01"],
  );
});

test("the group anchor is the mean of its boats", () => {
  assert.deepEqual(centroidOf([{ x: 0, y: 0 }, { x: 10, y: 20 }]), { x: 5, y: 10 });
  assert.equal(centroidOf([]), null);
  const anchor = averagePosition([
    { latitude: 33.74, longitude: -118.28 },
    { latitude: 33.76, longitude: -118.24 },
  ]);

  assert.ok(Math.abs(anchor.latitude - 33.75) < 1e-9);
  assert.ok(Math.abs(anchor.longitude - -118.26) < 1e-9);
  assert.equal(averagePosition([]), null);
});

test("a press becomes a drag only after it travels", () => {
  assert.equal(exceedsDragThreshold({ x: 10, y: 10 }, { x: 11, y: 11 }), false);
  assert.equal(exceedsDragThreshold({ x: 10, y: 10 }, { x: 10, y: 14 }), true);
  assert.equal(exceedsDragThreshold({ x: 10, y: 10 }, { x: 7, y: 10 }), true);
});

test("a plain click replaces the selection and an additive click toggles one boat", () => {
  assert.deepEqual(mergeSelection(["typhoon-01", "tempest-01"], "typhoon-02", false), ["typhoon-02"]);
  assert.deepEqual(
    mergeSelection(["typhoon-01"], "tempest-01", true),
    ["typhoon-01", "tempest-01"],
  );
  assert.deepEqual(
    mergeSelection(["typhoon-01", "tempest-01"], "typhoon-01", true),
    ["tempest-01"],
  );
});

test("re-clicking the only selected boat keeps the same selection value", () => {
  const current = ["typhoon-01"];

  assert.equal(mergeSelection(current, "typhoon-01", false), current);
});
