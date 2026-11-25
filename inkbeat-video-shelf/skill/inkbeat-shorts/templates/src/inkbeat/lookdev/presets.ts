// A look preset = lights + fog + sky + toon tint + post settings for one mood. Moods live in core/moods.ts.
//   <LookLights look={look} center={[x, 0, z]} />    // hemisphere + key + rim + fill + fog + toon tint
//   <LookSky look={look} t={t} />                    // SkyDome from look.sky
//   <PostFX settings={withShot(look.post, focusDist, "medium")} />
import { clamp, mix } from "../util";
import type { PostSettings } from "../post/PostFX";
import type { V3 } from "../types";

/** A directional light. `dir` points FROM the subject TO the light, in world space, for a camera looking
 * roughly toward −z (so dir z < 0 = the light is behind the subject = back/rim light). */
export type DirLight = { color: string; intensity: number; dir: V3 };

/** A recommended practical light (pointLight + emissive core + GlowSprite) for the sets. */
export type Practical = {
  color: string; // pointLight color
  intensity: number; // candela (three r155+ units, decay 2)
  distance: number; // meters (0 = infinite)
  decay: number;
  core: string; // emissive color of the bulb / flame / window pane
  coreIntensity: number; // emissiveIntensity (linear HDR; > bloom.threshold so it blooms)
  glow: number; // GlowSprite opacity
  glowSize: number; // GlowSprite size as a multiple of the emitter's diameter (bulb 0.4 m × 10 = 4 m halo; a ~1 m window pane: ≈ meters)
};

export type LookPreset = {
  lights: {
    /** floor light: unlit faces land at the target shadow L* (night ≈ 25–35) */
    hemi: { sky: string; ground: string; intensity: number };
    /** shaping light (sun / moon / window), casts shadows */
    key: DirLight & { castShadow: boolean; shadowBias: number; shadowNormalBias: number; mapSize: number };
    /** separation light: bright edge on silhouettes, no shadows */
    rim: DirLight;
    /** cool/warm counter light, no shadows */
    fill: DirLight;
    /** the warm practicals of this mood (lamp / lantern / candle / windows / lens) */
    practical: Practical;
    /** lit windows / window panes */
    window: Practical;
  };
  /** FogExp2. 50% fog at distance d  ⇔  density = 0.8326 / d */
  fog: { color: string; density: number };
  sky: {
    top: string;
    mid: string;
    bottom: string;
    cloudColor: string;
    cloudLit: string;
    clouds: number; // 0..1 cover
    stars: number; // 0..1
    rays: number; // sun rays 0..1
    horizon: number; // elevation (sin) of the mid stop
    brush: number;
    sun: { dir: V3; color: string; size: number };
    sunOn: number; // 0..1 (blends; < 0.02 = no sun)
    moon: { dir: V3; color: string; size: number };
    moonOn: number;
  };
  /** global toon-material tint (mat/materials setToonLook): RGB multipliers in shade / in full key light */
  toon: { shadowTint: V3; shadowAmt: number; hiTint: V3; hiAmt: number; rimColor: string; rimAmt: number; paint: number };
  post: PostSettings;
};

// ------------------------------------------------------------------------------------------ blending
const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

function blendAny(a: unknown, b: unknown, u: number): unknown {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * u;
  if (isHex(a) && isHex(b)) return mix(a, b, u);
  if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => blendAny(x, b[i], u));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const o: Record<string, unknown> = {};
    const ka = a as Record<string, unknown>;
    const kb = b as Record<string, unknown>;
    for (const k of new Set([...Object.keys(ka), ...Object.keys(kb)])) {
      if (!(k in ka)) o[k] = kb[k];
      else if (!(k in kb)) o[k] = ka[k];
      else o[k] = blendAny(ka[k], kb[k], u);
    }
    return o;
  }
  return u < 0.5 ? a : b;
}

/** Deep blend of two presets: numbers lerp, #rrggbb colors mix, booleans switch at 0.5. */
export function blendLook(a: LookPreset, b: LookPreset, u: number): LookPreset {
  const k = clamp(u);
  if (k <= 0) return a;
  if (k >= 1) return b;
  return blendAny(a, b, k) as LookPreset;
}

// ------------------------------------------------------------------------------------------ helpers
export type ShotType = "wide" | "medium" | "close" | "macro";

/** Per-shot depth of field: focus on the subject at `focus` meters from the camera (max blur in px at 1080 wide). */
export function withShot(post: PostSettings, focus: number, shot: ShotType): PostSettings {
  const r = { wide: [3.5, 0.6], medium: [2.2, 1.4], close: [1.5, 2.4], macro: [1.0, 3.0] }[shot]; // mild DOF reads crisp
  return { ...post, dof: { enabled: true, focusDistance: focus, focusRange: focus * r[0], maxBlurPx: r[1] } };
}

/** Props for <SkyDome> from a look (sun/moon fade with sunOn/moonOn). */
export function skyProps(look: LookPreset, t: number) {
  const s = look.sky;
  return {
    top: s.top,
    mid: s.mid,
    bottom: s.bottom,
    cloudColor: s.cloudColor,
    cloudLit: s.cloudLit,
    t,
    clouds: s.clouds,
    stars: s.stars,
    rays: s.rays * s.sunOn,
    horizon: s.horizon,
    brush: s.brush,
    sun: s.sunOn > 0.02 ? { dir: s.sun.dir, color: mix(s.bottom, s.sun.color, s.sunOn), size: s.sun.size * (0.5 + 0.5 * s.sunOn) } : undefined,
    moon: s.moonOn > 0.02 ? { dir: s.moon.dir, color: mix(s.mid, s.moon.color, s.moonOn), size: s.moon.size } : undefined,
  };
}
