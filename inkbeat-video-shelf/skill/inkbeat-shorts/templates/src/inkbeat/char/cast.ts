// Three example characters of the family, ready to spread into <Character3D {...CAST.adult} position={...} />.
// Copy one and change the overrides to design your own: build (proportions), look (skin, outfit, colors, hair, hat,
// glasses, facial hair, face style). Keep every character of a film inside one family (family.ts).
import type { CharacterSpec } from "./Character3D";
import { CLOTH, ELDER_BUILD, HAIR, KID_BUILD, SKIN } from "./family";

export const CAST = {
  /** an adult: block torso, open jacket over a shirt, swept hair, a hook nose */
  adult: {
    height: 1.74,
    build: { torso: "block", torsoWidth: 1.02 },
    look: {
      skin: SKIN.medium,
      outfit: "jacket",
      colors: { top: CLOTH.teal, inner: CLOTH.cream, bottom: CLOTH.charcoal, shoes: CLOTH.oxblood, accent: CLOTH.horn },
      hair: "swoop",
      hairColor: HAIR.espresso,
      face: { nose: "hook", blush: 0.22, brow: 1.1 },
      seed: 3,
    },
  },
  /** a kid: a bigger head (1.32x), a barrel torso, shorter arms and legs, overalls, a cap, curly hair */
  kid: {
    height: 1.16,
    build: KID_BUILD,
    look: {
      skin: SKIN.brown,
      outfit: "overalls",
      colors: { top: CLOTH.denim, inner: CLOTH.mustard, bottom: CLOTH.denim, shoes: CLOTH.brick, accent: CLOTH.brass },
      hair: "curly",
      hairColor: HAIR.black,
      hat: "cap",
      face: { nose: "button", blush: 0.5, lash: true, eyeColor: "#2a1d1a" },
      seed: 6,
    },
  },
  /** an elder: a pear torso, a 9° stoop, silver hair in a bun, round glasses, smile lines, an apron over a print dress */
  elder: {
    height: 1.62,
    build: ELDER_BUILD,
    look: {
      skin: SKIN.fair,
      outfit: "apron",
      colors: { top: CLOTH.mustard, inner: CLOTH.rose, bottom: CLOTH.cocoa, shoes: CLOTH.chestnut, accent: CLOTH.cream },
      hair: "bun",
      hairColor: HAIR.silver,
      glasses: true,
      face: { nose: "button", blush: 0.3, lines: true, brow: 1.25, eyeColor: "#4a5a6a" },
      seed: 9,
    },
  },
} satisfies Record<string, CharacterSpec>;
