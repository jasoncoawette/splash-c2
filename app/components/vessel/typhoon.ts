import * as THREE from "three";
import { buildCatamaran } from "./catamaran.ts";
import { TYPHOON_SPEC } from "./spec.ts";

// TYPHOON
//
// The tower boat: the family catamaran with a sensor mast stepped just aft of
// amidships. Shape and dimensions live in spec.ts, geometry in catamaran.ts;
// this file only caches the two templates the chart and the helm clone.

export const TYPHOON_LENGTH_M = TYPHOON_SPEC.lengthM;

let template: { selected: THREE.Group; resting: THREE.Group } | null = null;

/** Cached templates: each boat on the map is a cheap clone of one of these. */
export function typhoonTemplate(selected: boolean): THREE.Group {
  template ??= {
    resting: buildCatamaran(TYPHOON_SPEC, false),
    selected: buildCatamaran(TYPHOON_SPEC, true),
  };
  return selected ? template.selected : template.resting;
}

export function disposeTyphoonTemplate(): void {
  template = null;
}
