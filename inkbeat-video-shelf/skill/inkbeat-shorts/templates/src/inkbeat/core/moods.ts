// Act moods: lights + fog + sky + toon tint + post, built by one factory `mk` that applies the crisp + PREMIUM pass:
// stronger key and rim, less ambient, a fresnel rim on the toon material, soft halation (bloom on cores only, threshold
// 1.15), no grain, ink settings that never crawl (wobble 0, depth-jump test off, object-id edges on, skip ink under
// 2.5 px, flat normals for double-sided cloth). Light follows the acts: give each act its own mood.
// Each act keeps its own palette, but no mood is a one-color wash: the hemisphere ground and the shadow tint are always
// a complementary (violet/plum/blue) color against a warm key, and the fill comes from the opposite side, cool vs warm.
import type { LookPreset } from "../lookdev/presets";
import type { V3 } from "../types";

export type MoodPreset = LookPreset & {
  /** soft no-shadow light from just above/beside the lens (faces read in every framing) */
  camFill: { color: string; intensity: number };
  /** the light rig a character gets in this mood (see core/castLight.tsx) */
  castLight: { rim: { color: string; intensity: number }; fill: { color: string; intensity: number } };
  note: string;
};

type Sky = LookPreset["sky"];
const sky = (top: string, mid: string, bottom: string, o: Partial<Sky> = {}): Sky => ({
  top, mid, bottom, cloudColor: mid, cloudLit: "#fff4e4", clouds: 0.3, stars: 0, rays: 0, horizon: 0.16, brush: 0.05,
  sun: { dir: [-0.6, 0.12, -1], color: "#ffd9a0", size: 7 }, sunOn: 0, moon: { dir: [-0.4, 0.45, -1], color: "#e6eaff", size: 4 }, moonOn: 0, ...o,
});

type MkOpts = {
  note: string;
  hemi: [string, string, number];
  key: [string, number, V3];
  rim: [string, number, V3];
  fill: [string, number, V3];
  prac: [string, number, string];
  fog: [string, number];
  sky: Sky;
  toon: { shadowTint: V3; hiTint: V3; rimColor: string };
  grade: { exposure: number; contrast: number; saturation: number; shadowTint: string; highlightTint: string; gain: string };
  bloomTint: string;
  ink: string;
  camFill: [string, number];
  cast: { rim: [string, number]; fill: [string, number] };
};
export const mk = (o: MkOpts): MoodPreset => ({
  note: o.note,
  lights: {
    hemi: { sky: o.hemi[0], ground: o.hemi[1], intensity: o.hemi[2] },
    key: { color: o.key[0], intensity: o.key[1], dir: o.key[2], castShadow: true, shadowBias: -0.0004, shadowNormalBias: 0.025, mapSize: 2048 },
    rim: { color: o.rim[0], intensity: o.rim[1], dir: o.rim[2] },
    fill: { color: o.fill[0], intensity: o.fill[1], dir: o.fill[2] },
    practical: { color: o.prac[0], intensity: o.prac[1], distance: 6, decay: 2, core: o.prac[2], coreIntensity: 2.4, glow: 0.3, glowSize: 3.5 },
    window: { color: o.prac[0], intensity: 0, distance: 0, decay: 2, core: o.prac[2], coreIntensity: 1.6, glow: 0.2, glowSize: 2 },
  },
  fog: { color: o.fog[0], density: o.fog[1] },
  sky: o.sky,
  toon: { shadowTint: o.toon.shadowTint, shadowAmt: 0.9, hiTint: o.toon.hiTint, hiAmt: 0.6, rimColor: o.toon.rimColor, rimAmt: 0.42, paint: 0.05 },
  post: {
    outline: { enabled: true, color: o.ink, widthPx: 3.2, depthThreshold: 0.07, normalThreshold: 0.34, strength: 0.95, fadeNear: 8, fadeFar: 30, farWidth: 0.6, farOpacity: 0.45, wobble: 0, jumpEdges: 0, idEdges: 1, minPx: 2.5, clothFlat: true },
    dof: { enabled: true, focusDistance: 3, focusRange: 4, maxBlurPx: 1.4 },
    bloom: { enabled: true, threshold: 1.15, strength: 0.5, radiusPx: 42, scatter: 0.45, tint: o.bloomTint },
    grade: { exposure: o.grade.exposure, contrast: o.grade.contrast, saturation: o.grade.saturation, lift: "#2f232e", gamma: "#808080", gain: o.grade.gain, shadowTint: o.grade.shadowTint, highlightTint: o.grade.highlightTint, splitAmount: 0.1, sharpen: 0.45 },
    vignette: { amount: 0.22, softness: 0.8, color: "#1a1020" },
    grain: 0,
  },
  camFill: { color: o.camFill[0], intensity: o.camFill[1] },
  castLight: { rim: { color: o.cast.rim[0], intensity: o.cast.rim[1] }, fill: { color: o.cast.fill[0], intensity: o.cast.fill[1] } },
});

export const MOODS: Record<string, MoodPreset> = {
  /** bright crisp day: warm sun, blue sky fill, violet shade (L* ≈ 50–54) */
  day: mk({
    note: "bright crisp day", hemi: ["#cfe0ff", "#7a6a8a", 0.95], key: ["#fff0d6", 4.6, [0.55, 0.65, 0.45]], rim: ["#fff4dc", 1.8, [-0.6, 0.45, -0.7]],
    fill: ["#a8b8ff", 0.45, [-0.7, 0.3, 0.5]], prac: ["#ffd8a0", 3, "#fff0d0"], fog: ["#d0dcf0", 0.004],
    sky: sky("#3f7ae6", "#8ab8f4", "#e4f0ff", { sunOn: 0.7, clouds: 0.35, sun: { dir: [0.55, 0.5, -0.6], color: "#fff1c9", size: 6 } }),
    toon: { shadowTint: [0.88, 0.86, 1.14], hiTint: [1.06, 1.02, 0.92], rimColor: "#fff0d8" },
    grade: { exposure: 0.88, contrast: 1.14, saturation: 1.14, shadowTint: "#4a4aa0", highlightTint: "#fff2d8", gain: "#fbfcff" }, bloomTint: "#fff0d8", ink: "#1a1424",
    camFill: ["#eef2ff", 0.25], cast: { rim: ["#fff0d0", 1.8], fill: ["#e0e8ff", 0.6] },
  }),
  /** dusk: a warm practical against a violet-blue sky */
  dusk: mk({
    note: "dusk, warm practicals", hemi: ["#b8a0e0", "#5a3040", 0.75], key: ["#ff9a50", 4.2, [-0.7, 0.35, -0.4]], rim: ["#ffb060", 2.6, [0.6, 0.4, -0.8]],
    fill: ["#7a80ff", 0.5, [0.8, 0.3, 0.5]], prac: ["#ff8a30", 9, "#ffc070"], fog: ["#b07a90", 0.006],
    sky: sky("#3a3a9a", "#c070a0", "#ffb070", { sunOn: 0.7, rays: 0.25, clouds: 0.35, cloudLit: "#ffb880" }),
    toon: { shadowTint: [0.95, 0.75, 1.1], hiTint: [1.12, 0.98, 0.84], rimColor: "#ffc080" },
    grade: { exposure: 0.92, contrast: 1.16, saturation: 1.2, shadowTint: "#5a2a7a", highlightTint: "#ffd0a0", gain: "#fff6ea" }, bloomTint: "#ffb070", ink: "#1e0f14",
    camFill: ["#ffd8c0", 0.25], cast: { rim: ["#ffb060", 2.2], fill: ["#d8c8ff", 0.6] },
  }),
  /** night: blue moon key, a warm lamp / lantern practical */
  night: mk({
    note: "night, moon key, warm practical", hemi: ["#4a5ac8", "#1e1630", 0.82], key: ["#a8b8ff", 2.8, [-0.5, 0.6, -0.6]], rim: ["#d8e0ff", 2.4, [0.6, 0.45, -0.7]],
    fill: ["#ffb060", 0.45, [0.6, 0.2, 0.7]], prac: ["#ffb050", 7, "#ffd890"], fog: ["#2a3070", 0.006],
    sky: sky("#141a5a", "#2a3a9a", "#5a6ad0", { moonOn: 0.9, clouds: 0.25, cloudColor: "#222a7a", cloudLit: "#6a7ae0" }),
    toon: { shadowTint: [0.82, 0.86, 1.2], hiTint: [1.0, 1.02, 1.1], rimColor: "#cdd6ff" },
    grade: { exposure: 0.72, contrast: 1.14, saturation: 1.12, shadowTint: "#2a3a9a", highlightTint: "#ffe0b0", gain: "#e8ecff" }, bloomTint: "#ffd8a0", ink: "#0c0c1e",
    camFill: ["#c8d0ff", 0.3], cast: { rim: ["#d8e0ff", 2.0], fill: ["#ffc890", 0.7] },
  }),
  /** a cold interior: cool white key, cyan fill */
  cold: mk({
    note: "cold interior", hemi: ["#c8e4f8", "#4a6a8a", 0.7], key: ["#f4fbff", 3.6, [0.4, 0.8, 0.45]], rim: ["#a8f0ff", 2.2, [-0.6, 0.5, -0.7]],
    fill: ["#6ad8ff", 0.6, [-0.8, 0.3, 0.4]], prac: ["#c8f0ff", 5, "#f0fcff"], fog: ["#c8e8f4", 0.006],
    sky: sky("#8ac0e8", "#c8e4f4", "#eef8ff"), toon: { shadowTint: [0.8, 0.95, 1.18], hiTint: [1.0, 1.04, 1.08], rimColor: "#c8f8ff" },
    grade: { exposure: 0.62, contrast: 1.16, saturation: 1.12, shadowTint: "#1a5a8a", highlightTint: "#f0faff", gain: "#f6fcff" }, bloomTint: "#d8f4ff", ink: "#0a1420",
    camFill: ["#e8f8ff", 0.3], cast: { rim: ["#b8f4ff", 1.8], fill: ["#e0f0ff", 0.6] },
  }),
  /** a warm lamp-lit interior at night */
  lamp: mk({
    note: "lamp-lit interior at night", hemi: ["#7a6ab0", "#2a1a24", 0.7], key: ["#ffc070", 4.2, [0.5, 0.75, 0.3]], rim: ["#8a9aff", 1.6, [-0.6, 0.4, -0.7]],
    fill: ["#6a70d0", 0.35, [-0.8, 0.3, 0.4]], prac: ["#ffb050", 8, "#ffe0a0"], fog: ["#2a1a30", 0.004],
    sky: sky("#101030", "#181a40", "#20204a"), toon: { shadowTint: [0.9, 0.78, 1.12], hiTint: [1.12, 1.0, 0.82], rimColor: "#b0b8ff" },
    grade: { exposure: 1.0, contrast: 1.18, saturation: 1.15, shadowTint: "#3a1a5a", highlightTint: "#ffd8a0", gain: "#fff4e4" }, bloomTint: "#ffc070", ink: "#160c10",
    camFill: ["#ffe0c0", 0.25], cast: { rim: ["#ffc070", 1.8], fill: ["#c0c8ff", 0.5] },
  }),
  /** golden hour: low warm sun, long shadows, violet shade */
  golden: mk({
    note: "golden hour", hemi: ["#ffe0b0", "#6a4a7a", 0.9], key: ["#ffc060", 5.2, [-0.7, 0.3, 0.45]], rim: ["#ffe090", 2.8, [0.6, 0.35, -0.8]],
    fill: ["#a090e0", 0.5, [0.8, 0.3, 0.4]], prac: ["#ffb050", 6, "#ffe0a0"], fog: ["#e0a070", 0.005],
    sky: sky("#5a7ae0", "#ffb070", "#ffe0a0", { sunOn: 0.9, rays: 0.3, clouds: 0.3, cloudLit: "#ffd8a0" }),
    toon: { shadowTint: [0.95, 0.82, 1.08], hiTint: [1.14, 1.02, 0.8], rimColor: "#ffd890" },
    grade: { exposure: 0.85, contrast: 1.14, saturation: 1.12, shadowTint: "#5a3a7a", highlightTint: "#ffe0a0", gain: "#fff4e0" }, bloomTint: "#ffd080", ink: "#1e1008",
    camFill: ["#ffe8c8", 0.25], cast: { rim: ["#ffd070", 2.2], fill: ["#e0d8ff", 0.5] },
  }),
};
export const moodOf = (id: string): MoodPreset => MOODS[id] ?? MOODS.day;
