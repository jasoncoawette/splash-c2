import type { Position } from "./types";
import { assertPosition } from "./validation.ts";

const EARTH_RADIUS_NM = 3440.065;

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function toDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}

function normalizeLongitude(longitude: number): number {
  return ((longitude + 540) % 360) - 180;
}

export function distanceBetween(start: Position, destination: Position): number {
  assertPosition(start);
  assertPosition(destination);

  const startLatitude = toRadians(start.latitude);
  const destinationLatitude = toRadians(destination.latitude);
  const latitudeChange = destinationLatitude - startLatitude;
  const longitudeChange = toRadians(destination.longitude - start.longitude);

  const haversine =
    Math.sin(latitudeChange / 2) ** 2 +
    Math.cos(startLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(longitudeChange / 2) ** 2;

  const centralAngle = 2 * Math.atan2(
    Math.sqrt(haversine),
    Math.sqrt(1 - haversine),
  );

  return EARTH_RADIUS_NM * centralAngle;
}

export function bearingBetween(start: Position, destination: Position): number {
  assertPosition(start);
  assertPosition(destination);

  const startLatitude = toRadians(start.latitude);
  const destinationLatitude = toRadians(destination.latitude);
  const longitudeChange = toRadians(destination.longitude - start.longitude);

  const y = Math.sin(longitudeChange) * Math.cos(destinationLatitude);
  const x =
    Math.cos(startLatitude) * Math.sin(destinationLatitude) -
    Math.sin(startLatitude) *
      Math.cos(destinationLatitude) *
      Math.cos(longitudeChange);

  if (x === 0 && y === 0) {
    return 0;
  }

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Walk a great circle from a position along a compass heading. Mission plans
 * and manual steering both need a destination that no waypoint supplies, and
 * `moveToward` is the same walk with its heading read off a destination.
 */
export function advanceAlongHeading(
  start: Position,
  headingDegrees: number,
  distanceNm: number,
): Position {
  assertPosition(start);

  if (!Number.isFinite(headingDegrees)) {
    throw new Error("Heading must be a finite number");
  }

  if (!Number.isFinite(distanceNm) || distanceNm < 0) {
    throw new Error("Movement distance must be a non-negative finite number");
  }

  if (distanceNm === 0) {
    return { ...start };
  }

  const startLatitude = toRadians(start.latitude);
  const startLongitude = toRadians(start.longitude);
  const bearing = toRadians(headingDegrees);
  const angularDistance = distanceNm / EARTH_RADIUS_NM;

  const latitude = Math.asin(
    Math.sin(startLatitude) * Math.cos(angularDistance) +
      Math.cos(startLatitude) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const longitude =
    startLongitude +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(startLatitude),
      Math.cos(angularDistance) - Math.sin(startLatitude) * Math.sin(latitude),
    );

  return {
    latitude: toDegrees(latitude),
    longitude: normalizeLongitude(toDegrees(longitude)),
  };
}

export function moveToward(
  start: Position,
  destination: Position,
  distanceNm: number,
): Position {
  assertPosition(start);
  assertPosition(destination);

  if (!Number.isFinite(distanceNm) || distanceNm < 0) {
    throw new Error("Movement distance must be a non-negative finite number");
  }

  if (distanceNm >= distanceBetween(start, destination)) {
    return { ...destination };
  }

  return advanceAlongHeading(start, bearingBetween(start, destination), distanceNm);
}
