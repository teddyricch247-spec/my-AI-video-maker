// PostFX: a multi-pass post-processing chain for <ThreeCanvas>.
// Ink outlines (depth + normals), depth of field, bloom, color grade, vignette, paper grain.
// Place <PostFX settings={...} /> anywhere inside <ThreeCanvas>; it takes over rendering
// (useFrame with priority 1, so R3F skips its own gl.render).
import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useMemo, useRef } from "react";
import { useCurrentFrame } from "remotion";
import { PostPipeline } from "./pipeline";

export type PostSettings = {
  outline: {
    enabled: boolean;
    color: string;
    widthPx: number; // line width in px at 1080 width
    depthThreshold: number; // relative 1/z jump that counts as a silhouette (0.02..0.1)
    normalThreshold: number; // 1 - cos(angle) between neighboring normals (0.1..0.6)
    strength: number; // 0..1 ink opacity
    // optional extras: distance falloff (world units from camera)
    fadeNear?: number; // lines are full width/opacity up to here (default 25)
    fadeFar?: number; // ... and reach farWidth/farOpacity here (default 160)
    farWidth?: number; // width multiplier far away (default 0.55)
    farOpacity?: number; // opacity multiplier far away (default 0.5)
    wobble?: number; // 0..1 hand-inked width variation along the lines (default 0.35)
    supersample?: 1 | 2; // resolution of the depth/normal/edge buffers (default 2 = anti-aliased lines)
    // weight of the one-sided depth "jump" test (default 1). It also fires on planes seen at a grazing angle (1/z has a
    // gradient there), where it hovers around the threshold and draws dotted, crawling ink; 0 keeps only the
    // planar-exact second-derivative test, which still catches every silhouette
    jumpEdges?: number;
    // ink every boundary between two different objects (object id written by the normal pass), 0..1 (default 0)
    idEdges?: number;
    // no ink on objects whose projected thickness is below this many px (default 0 = off)
    minPx?: number;
    // double-sided surfaces (curtains, cloth, leaves) ink only their silhouettes, not their folds (default false)
    clothFlat?: boolean;
  };
  dof: { enabled: boolean; focusDistance: number; focusRange: number; maxBlurPx: number }; // world units from camera
  bloom: {
    enabled: boolean;
    threshold: number; // linear scene value where bloom starts (soft knee below)
    strength: number;
    radiusPx: number; // approximate halo radius in px at 1080 width
    scatter?: number; // 0..1 how much the wide levels dominate (default 0.72)
    tint?: string; // multiply the halo color (default #ffffff)
  };
  grade: {
    exposure: number; // stops
    contrast: number; // 1 = neutral
    saturation: number; // 1 = neutral
    lift: string; // added to shadows, neutral #000000
    gamma: string; // maps mid-gray 0.5 to this value, neutral #808080
    gain: string; // multiplies, neutral #ffffff
    shadowTint: string; // split toning: chroma of this color added to shadows
    highlightTint: string; // ... and of this one to highlights
    splitAmount: number; // 0..1
    sharpen?: number; // optional local-contrast boost for textures, 0..1 (default 0)
  };
  vignette: { amount: number; softness: number; color: string }; // corners mix toward color*image by amount
  grain: number; // 0..1 subtle paper/film texture
};

/** Tuned defaults: bold plum-black ink on all geometry,
 * gentle background blur, warm halo on practicals, plum shadows, cream highlights,
 * corners ~0.82 of the center. */
export const defaultPost: PostSettings = {
  outline: {
    enabled: true,
    color: "#17111c",
    widthPx: 4.0,
    depthThreshold: 0.04,
    normalThreshold: 0.28,
    strength: 0.95,
    fadeNear: 25,
    fadeFar: 160,
    farWidth: 0.55,
    farOpacity: 0.55,
    wobble: 0.35,
  },
  dof: { enabled: true, focusDistance: 8, focusRange: 30, maxBlurPx: 7 },
  bloom: { enabled: true, threshold: 1.0, strength: 1.3, radiusPx: 90, scatter: 0.72, tint: "#ffe2b8" },
  grade: {
    exposure: 0.05,
    contrast: 1.2,
    saturation: 1.24,
    lift: "#100a18",
    gamma: "#818080",
    gain: "#fffcf6",
    shadowTint: "#4e3a96",
    highlightTint: "#ffdca0",
    splitAmount: 0.1,
    sharpen: 0.4,
  },
  vignette: { amount: 0.28, softness: 0.8, color: "#4a3050" },
  grain: 0.35,
};

/** Merge a partial override into defaultPost (handy for per-shot looks). */
export const withPost = (o: DeepPartial<PostSettings>, base: PostSettings = defaultPost): PostSettings => ({
  outline: { ...base.outline, ...(o.outline ?? {}) },
  dof: { ...base.dof, ...(o.dof ?? {}) },
  bloom: { ...base.bloom, ...(o.bloom ?? {}) },
  grade: { ...base.grade, ...(o.grade ?? {}) },
  vignette: { ...base.vignette, ...(o.vignette ?? {}) },
  grain: o.grain ?? base.grain,
});
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

/** Starting points per act (extra export). Use them directly or merge tweaks with withPost. */
export const postLooks = {
  day: defaultPost,
  // blue night with warm practicals: cool lifted blacks, ultramarine shadows, strong lamp halos
  night: withPost({
    bloom: { strength: 1.6, radiusPx: 110, tint: "#ffd09a" },
    grade: {
      exposure: 0.12,
      contrast: 1.22,
      saturation: 1.16,
      lift: "#0a0c2a",
      gamma: "#7c7f90",
      gain: "#f6f6ff",
      shadowTint: "#3440b4",
      highlightTint: "#ffc070",
      splitAmount: 0.2,
    },
    vignette: { amount: 0.42, softness: 0.85, color: "#141850" },
  }),
  // storm: darker, harder, colder; lightning flashes come from the scene lights
  storm: withPost({
    dof: { maxBlurPx: 5 },
    bloom: { strength: 1.4, radiusPx: 100, tint: "#d8e0ff" },
    grade: {
      exposure: 0.05,
      contrast: 1.3,
      saturation: 1.2,
      lift: "#080a26",
      gamma: "#787b92",
      gain: "#eef0ff",
      shadowTint: "#3038b0",
      highlightTint: "#c8d8ff",
      splitAmount: 0.18,
    },
    vignette: { amount: 0.5, softness: 0.85, color: "#101444" },
  }),
  // pink dawn / golden ending: warm highlights, magenta shadows, big soft sun bloom
  dawn: withPost({
    bloom: { threshold: 0.9, strength: 1.4, radiusPx: 140, tint: "#ffc8a0" },
    grade: {
      exposure: 0.1,
      contrast: 1.15,
      saturation: 1.2,
      lift: "#1a0a1e",
      gamma: "#848080",
      gain: "#fff2e6",
      shadowTint: "#7a3a8e",
      highlightTint: "#ffb48a",
      splitAmount: 0.18,
    },
    vignette: { amount: 0.3, softness: 0.8, color: "#5a2a50" },
  }),
  // lamp-lit interior / golden explanation close-up: warm, shallow focus
  interior: withPost({
    dof: { focusRange: 6, maxBlurPx: 10 },
    bloom: { threshold: 0.95, strength: 1.5, radiusPx: 100, tint: "#ffcf90" },
    grade: {
      exposure: 0.08,
      contrast: 1.2,
      saturation: 1.15,
      lift: "#160a18",
      gamma: "#838080",
      gain: "#fff4e4",
      shadowTint: "#5a2e7a",
      highlightTint: "#ffc878",
      splitAmount: 0.16,
    },
    vignette: { amount: 0.4, softness: 0.85, color: "#2a1630" },
  }),
};

export const PostFX: React.FC<{ settings: PostSettings }> = ({ settings }) => {
  const frame = useCurrentFrame();
  const pipeline = useMemo(() => new PostPipeline(), []);
  const sRef = useRef(settings);
  const fRef = useRef(frame);
  sRef.current = settings;
  fRef.current = frame;
  const { invalidate } = useThree();
  useEffect(() => () => pipeline.dispose(), [pipeline]);
  // in the studio (frameloop 'always' / 'demand') make sure a new frame is drawn on change
  useEffect(() => {
    invalidate();
  }, [settings, frame, invalidate]);
  useFrame((state) => {
    pipeline.render(state.gl, state.scene, state.camera, sRef.current, fRef.current);
  }, 1);
  return null;
};
