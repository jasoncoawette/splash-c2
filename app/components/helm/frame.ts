import { bearingBetween, distanceBetween } from "../../core/navigation.ts";
import type { BoatType, Position } from "../../core/types";

/**
 * Everything the console draws ahead of the boat — contacts, the heading tape
 * and the route lane — needs the same answer: where is that point relative to
 * this bow? One conversion keeps the three views agreeing with each other.
 */
export interface RelativeFix {
  distanceNm: number;
  /** Negative to port, positive to starboard, within -180..180. */
  relativeDegrees: number;
  forwardNm: number;
  rightNm: number;
}

export function relativeFix(
  origin: Position,
  headingDegrees: number,
  target: Position,
): RelativeFix {
  const distanceNm = distanceBetween(origin, target);
  const relativeDegrees =
    ((bearingBetween(origin, target) - headingDegrees + 540) % 360) - 180;
  const radians = (relativeDegrees * Math.PI) / 180;

  return {
    distanceNm,
    relativeDegrees,
    forwardNm: distanceNm * Math.cos(radians),
    rightNm: distanceNm * Math.sin(radians),
  };
}

export interface Contact extends RelativeFix {
  id: string;
  name: string;
  type: BoatType;
  speedKnots: number;
  /**
   * The contact's heading relative to ours, within -180..180. This is its
   * aspect: what the hull looks like from here, which is what a three
   * dimensional view needs to draw it turned the right way.
   */
  aspectDegrees: number;
}

export function contactsAhead(
  origin: Position,
  headingDegrees: number,
  others: readonly {
    id: string;
    name: string;
    type: BoatType;
    speedKnots: number;
    headingDegrees: number;
    position: Position;
  }[],
  fieldOfViewDegrees: number,
): Contact[] {
  return others
    .map((other) => ({
      id: other.id,
      name: other.name,
      type: other.type,
      speedKnots: other.speedKnots,
      aspectDegrees: ((other.headingDegrees - headingDegrees + 540) % 360) - 180,
      ...relativeFix(origin, headingDegrees, other.position),
    }))
    .filter((contact) => Math.abs(contact.relativeDegrees) <= fieldOfViewDegrees / 2)
    .sort((first, second) => first.distanceNm - second.distanceNm);
}

/** Minutes and seconds to a point at the current speed, blank when stopped. */
export function timeToPoint(distanceNm: number, speedKnots: number): string {
  if (speedKnots <= 0 || !Number.isFinite(distanceNm)) return "--:--:--";

  const totalSeconds = Math.round((distanceNm / speedKnots) * 3600);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
