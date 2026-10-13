import * as THREE from "three";

// TONE HIERARCHY
//
// Anatomy rule: base and structure are low tones, the working surfaces are mid,
// the subject is high, and exactly one accent is lit. Here the lit accent is the
// sensor package, because that is the part an operator is actually tasking.

export const ACCENT_HEX = 0x52cbff;

export type ToneKey =
  | "hullDark"
  | "hullTopside"
  | "boot"
  | "rubber"
  | "deck"
  | "nonSkid"
  | "trunk"
  | "composite"
  | "steel"
  | "brightMetal"
  | "dome"
  | "optic"
  | "accent"
  | "lightRed"
  | "lightGreen";

export type VesselMaterials = Readonly<Record<ToneKey, THREE.MeshStandardMaterial>>;

function pbr(
  color: number,
  metalness: number,
  roughness: number,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
}

function createMaterials(selected: boolean): VesselMaterials {
  return {
    // Hull: the photographs show a near-black bottom under a graphite topside.
    hullDark: pbr(0x1a242a, 0.18, 0.64),
    hullTopside: pbr(0x36474f, 0.22, 0.56),
    boot: pbr(0x121a1f, 0.3, 0.6),
    rubber: pbr(0x0e1316, 0.05, 0.86),

    // Deck: light grey composite with a darker non-skid field.
    deck: pbr(0xc6d1d4, 0.14, 0.66),
    nonSkid: pbr(0x79868c, 0.1, 0.88),
    trunk: pbr(0xdee4e6, 0.12, 0.5),

    // Equipment.
    composite: pbr(0x222a2e, 0.14, 0.78),
    steel: pbr(0x7d888d, 0.5, 0.52),
    brightMetal: pbr(0xa8b2b6, 0.6, 0.44),
    dome: pbr(0xe7edef, 0.05, 0.52),
    optic: pbr(0x05080a, 0.35, 0.32),

    // The one lit part: sensor glow, selection ring, masthead strobe.
    accent: pbr(ACCENT_HEX, 0.2, 0.3, {
      emissive: ACCENT_HEX,
      emissiveIntensity: selected ? 1.8 : 0.6,
    }),

    lightRed: pbr(0xff3b30, 0.2, 0.3, {
      emissive: 0xff3b30,
      emissiveIntensity: 1.5,
    }),
    lightGreen: pbr(0x25d366, 0.2, 0.3, {
      emissive: 0x25d366,
      emissiveIntensity: 1.5,
    }),

  };
}

let restingMaterials: VesselMaterials | null = null;
let selectedMaterials: VesselMaterials | null = null;

export function vesselMaterials(selected: boolean): VesselMaterials {
  if (selected) {
    selectedMaterials ??= createMaterials(true);
    return selectedMaterials;
  }

  restingMaterials ??= createMaterials(false);
  return restingMaterials;
}

export function disposeMaterials(): void {
  for (const set of [restingMaterials, selectedMaterials]) {
    if (!set) continue;
    for (const material of Object.values(set)) material.dispose();
  }

  restingMaterials = null;
  selectedMaterials = null;
}
