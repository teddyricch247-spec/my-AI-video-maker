// The character family: every design number in one place. Change these to design your own family; change the
// per-character overrides (Build, Look, FaceStyle) to design one character inside it.
//
// Units: a character is built at height h = 1 (soles to the top of the skull, without a hat) and scaled to its
// `height` in world units. Head and face numbers are in head half-widths ("hw") where noted.
//
// The default family:
//   - an egg head, a little taller than wide, with a rounded crown, a defined chin, fuller cheeks and small ears;
//   - a short skin neck and a torso as wide as the head or wider (block, barrel or pear);
//   - thick two-tone limbs: sleeves in the top color, pants in the bottom color, skin hands with a thumb,
//     small shoes with a sole;
//   - warm, real skin tones; painted outfits with seams, stitching, pockets and buttons;
//   - a drawn face: oval eyes with a highlight and an upper lid line, thick arched brows in the hair color,
//     a small nose, a mouth with a lip line, cheek blush;
//   - a deep indigo-brown ink, heavier on the character than on the set.

// ------------------------------------------------------------------ head (h = 1)
/** head half-width: the head is 0.27 h wide at the default head scale */
export const HEAD_HW = 0.135;
/** crown radius / hw (rounded top) */
export const HEAD_TOP = 1.06;
/** jaw radius / hw: a longer lower half gives the egg shape and the chin */
export const HEAD_BOT = 1.2;
/** depth radius / hw */
export const HEAD_DEPTH = 0.94;
/** superellipse exponent at the crown (a touch boxier than a sphere) */
export const HEAD_EXP_TOP = 2.35;
/** superellipse exponent at the chin (below 2: a defined, slightly pointed chin) */
export const HEAD_EXP_CHIN = 1.82;
/** jaw narrowing toward the chin (fraction of the width) */
export const JAW_TAPER = 0.22;
/** cheek fullness just below the eyes (fraction of the width) */
export const CHEEK_FULL = 0.045;
/** seeded hand-made wobble: amplitude ranges of the 2nd and 4th harmonics around the face outline */
export const HEAD_WOBBLE: [number, number, number, number] = [0.009, 0.008, 0.005, 0.005];
/** seeded hand-made head roll, degrees (never quite straight) */
export const HEAD_ROLL = [2, 5] as const;
/** ear: size in hw (height, width, depth) and its height on the head (hw, + = up) */
export const EAR = { h: 0.33, w: 0.2, d: 0.13, y: -0.1 };

// ------------------------------------------------------------------ neck and torso (h = 1)
/** visible neck length and radius */
export const NECK_LEN = 0.035;
export const NECK_R = 0.044;
/** the torso's rounded top tucks this far above the chin line (hidden inside the neck) */
export const TORSO_TUCK = 0.012;
/** torso height and half-width (width 0.28 h: never narrower than the head) */
export const TORSO_H = 0.29;
export const TORSO_R = 0.14;
/** torso depth / width */
export const TORSO_DEPTH = 0.72;
export type TorsoKind = "block" | "barrel" | "pear";
/** torso profiles: [t (0 = bottom, 1 = top), radius / TORSO_R] and the cross-section exponent (2 = round,
 *  higher = squarer). block = broad shoulders tapering down, barrel = widest at the middle, pear = widest low. */
export const TORSO_SHAPES: Record<TorsoKind, { profile: [number, number][]; cross: number }> = {
  block: {
    profile: [[0, 0], [0.035, 0.66], [0.11, 0.86], [0.3, 0.88], [0.55, 0.93], [0.76, 1.0], [0.88, 0.97], [0.95, 0.74], [1, 0]],
    cross: 2.9,
  },
  barrel: {
    profile: [[0, 0], [0.045, 0.6], [0.15, 0.87], [0.36, 0.99], [0.56, 1.0], [0.75, 0.93], [0.88, 0.8], [0.95, 0.6], [1, 0]],
    cross: 2.15,
  },
  pear: {
    profile: [[0, 0], [0.04, 0.64], [0.13, 0.93], [0.3, 1.0], [0.5, 0.94], [0.7, 0.83], [0.85, 0.76], [0.94, 0.6], [1, 0]],
    cross: 2.0,
  },
};
/** shoulder joint: height as a fraction of the torso height, and inset from the torso surface */
export const SHOULDER_T = 0.83;
export const SHOULDER_IN = 0.78;
/** hip joints: height above the torso bottom (fraction of the torso height) and spread (fraction of TORSO_R) */
export const HIP_T = 0.11;
export const HIP_X = 0.4;

// ------------------------------------------------------------------ limbs (h = 1)
export const UPPER_ARM = 0.125;
export const FOREARM = 0.112;
/** the arm plane is turned this far toward the front so arms read in 3/4 views (degrees) */
export const ARM_PLANE_DEG = 9;
/** sleeve radius at the shoulder and at the wrist */
export const ARM_R: [number, number] = [0.026, 0.021];
/** pant-leg radius at the hip and at the ankle */
export const LEG_R: [number, number] = [0.034, 0.027];
/** hand ball radius; the thumb is THUMB × that */
export const HAND_R = 0.031;
export const THUMB = 0.44;
/** ankle height (the shoe sits below it) and the leg spread at the ankle (fraction of TORSO_R) */
export const ANKLE_Y = 0.05;
export const FOOT_X = 0.44;
/** shoe: half-width, height, half-length, toe offset forward; sole thickness */
export const SHOE = { w: 0.03, h: 0.042, l: 0.058, fwd: 0.022, sole: 0.011 };
/** walk: stride (forward swing at the ankle), foot lift, arm swing at the hand */
export const WALK = { stride: 0.085, lift: 0.035, arm: 0.05 };

// ------------------------------------------------------------------ face layout (hw, canvas y down)
/** the face decal covers x, y in [-FACE_SPAN, FACE_SPAN] hw around the head center */
export const FACE_SPAN = 1.3;
export const EYE_X = 0.36;
export const EYE_Y = -0.03;
/** open eye: iris half-size (hw) */
export const IRIS = { rx: 0.092, ry: 0.124 };
export const BROW_UP = 0.3;
export const NOSE_Y = 0.3;
export const MOUTH_Y = 0.62;
export const CHEEK = { x: 0.55, y: 0.36, rx: 0.19, ry: 0.11 };

// ------------------------------------------------------------------ palette
/** a warm, real skin range */
export const SKIN = {
  fair: "#f2cfb6",
  light: "#e9b994",
  medium: "#d39a72",
  tan: "#b77a52",
  brown: "#8e5a3c",
  deep: "#5f3a28",
} as const;
export const HAIR = {
  espresso: "#3d2a22",
  black: "#26232b",
  auburn: "#a04e2c",
  honey: "#c99a52",
  silver: "#b9bbc0",
  snow: "#e2e0dc",
} as const;
export const CLOTH = {
  teal: "#2e8a86",
  mustard: "#d6a137",
  brick: "#b0503c",
  sage: "#7c9868",
  cobalt: "#3d5fbf",
  cream: "#efe6d2",
  rose: "#c46a78",
  denim: "#3c5280",
  charcoal: "#3b3d46",
  khaki: "#a88e63",
  cocoa: "#6b4b3b",
  chestnut: "#5a3a2b",
  graphite: "#2b2d35",
  oxblood: "#6e2e2a",
  horn: "#e8d6a8",
  brass: "#c99f4b",
} as const;
/** default hat colors */
export const HAT_COLORS: Record<string, string> = { cap: "#c94a3a", flat: "#7d6a55", beanie: "#3f8f6e", sunhat: "#e3c98e" };
/** face colors */
export const FACE_COLORS = {
  eye: "#3a2a24",
  sclera: "#fbfbf7",
  glint: "#fdfdfb",
  mouth: "#5b1e2e",
  tongue: "#e2727c",
  teeth: "#f7f8f2",
  blush: "#ec7a7f",
  sweat: "#9ed3f2",
};
/** contact shadow under the feet (rgb) and its opacity */
export const CONTACT = { rgb: [28, 34, 52] as [number, number, number], opacity: 0.45, size: 1.65 };

// ------------------------------------------------------------------ ink and light
/** ink color for every character hull and the face lines (a deep indigo-brown) */
export const INK = "#1b1a2a";
/** ink hull width as a fraction of the head width (about 3.4%), never under MIN px, capped at MAX px */
export const INK_K = 0.034;
export const INK_PX = { min: 2.4, max: 6.5 };
/** hull width multipliers per part, and how much heavier the hull gets on the underside */
export const INK_PARTS = {
  head: [1, 0.75],
  hair: [0.72, 0.35],
  hat: [0.82, 0.35],
  torso: [0.95, 0.5],
  limb: [0.55, 0.4],
  hand: [0.55, 0.4],
  shoe: [0.78, 0.3],
  ear: [0.55, 0.3],
} as const;
/** the character material: soft wrap light, warm skin shade, cool cloth shade, a back rim */
export const LIGHT = {
  shadowTint: [0.9, 0.92, 1.08] as [number, number, number], // ambient multiplier on cloth / hair / hats (cool)
  skinShade: [1.07, 0.93, 0.9] as [number, number, number], // extra warmth in the skin's shadow side
  rim: 0.68,
  edge: 0.13,
  fillRim: 0.05,
  skinKeep: 0.45, // how much a warm key is desaturated on skin (skin keeps its own color under lamps)
  skinLift: 1.4, // gentle lift of mid / shadow skin (1 = off)
  skinWhite: 0.03, // pull of lit skin toward neutral (keep low: real skin tones)
  skinMax: 0.94, // skin and face whites never clip
  inkDeep: 0.05,
  clothSpec: 0.3, // restrained fabric sheen
};

// ------------------------------------------------------------------ per-character overrides
export type Build = {
  /** head size multiplier (kids 1.25–1.35, adults 0.95–1.05) */
  headScale: number;
  torso: TorsoKind;
  /** torso width and depth multipliers (keep width ≥ 0.95 so the torso is as wide as the head) */
  torsoWidth: number;
  torsoDepth: number;
  /** torso height multiplier (legs take what is left) */
  torsoHeight: number;
  /** limb thickness multiplier */
  limb: number;
  /** arm length multiplier (kids ~0.82) */
  armLength: number;
  /** hand size multiplier */
  hand: number;
  /** forward bend of the upper body at the hips, degrees (elders 6–12) */
  stoop: number;
  /** neck length multiplier */
  neck: number;
};
export const DEFAULT_BUILD: Build = {
  headScale: 1,
  torso: "block",
  torsoWidth: 1,
  torsoDepth: 1,
  torsoHeight: 1,
  limb: 1,
  armLength: 1,
  hand: 1,
  stoop: 0,
  neck: 1,
};
export const buildOf = (b?: Partial<Build>): Build => ({ ...DEFAULT_BUILD, ...(b ?? {}) });

/** presets to start from */
export const KID_BUILD: Partial<Build> = { headScale: 1.32, torso: "barrel", torsoWidth: 0.96, torsoHeight: 0.9, limb: 0.9, armLength: 0.8, hand: 0.92, neck: 0.6 };
export const ELDER_BUILD: Partial<Build> = { torso: "pear", torsoWidth: 1.06, torsoDepth: 1.06, armLength: 0.97, stoop: 9, neck: 0.8 };

export type FaceStyle = {
  eyeColor: string;
  /** brow color; default: the hair color, darkened */
  browColor?: string;
  /** brow thickness multiplier */
  brow: number;
  nose: "hook" | "button" | "none";
  /** cheek blush 0..1 */
  blush: number;
  /** a lash flick at the outer end of the lid line */
  lash: boolean;
  /** smile lines at the mouth corners and under the eyes (elders) */
  lines: boolean;
};
export const DEFAULT_FACE_STYLE: FaceStyle = { eyeColor: FACE_COLORS.eye, brow: 1, nose: "hook", blush: 0.35, lash: false, lines: false };
