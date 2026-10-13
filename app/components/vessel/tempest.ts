import * as THREE from "three";
import { buildCatamaran } from "./catamaran.ts";
import { TEMPEST_SPEC } from "./spec.ts";

// TEMPEST
//
// The flat boat: the same catamaran, larger, with nothing standing on the deck.
// The whole of it is payload space, which is the point of the class.

export const TEMPEST_LENGTH_M = TEMPEST_SPEC.lengthM;

let template: { selected: THREE.Group; resting: THREE.Group } | null = null;

export function tempestTemplate(selected: boolean): THREE.Group {
  template ??= {
    resting: buildCatamaran(TEMPEST_SPEC, false),
    selected: buildCatamaran(TEMPEST_SPEC, true),
  };
  return selected ? template.selected : template.resting;
}

export function disposeTempestTemplate(): void {
  template = null;
}
