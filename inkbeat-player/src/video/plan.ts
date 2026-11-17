// THE PLAN: shots, light and key words, all anchored to WORDS of the transcript (never to typed seconds).
// Rebuild this file for every transcript: one Shot per beat of the story (see START_HERE.md, section 4).
import { CAST } from "../inkbeat/char/cast";
import { headOf } from "../inkbeat/char/Character3D";
import { aim } from "../inkbeat/core/rig";
import type { V3 } from "../inkbeat/types";
import { anchorOf, buildTimeline } from "../player/timing";
import { beatsFor } from "./beats";
import { TRANSCRIPT } from "./transcript";
import type { Shot } from "./types";

export const TL = buildTimeline(TRANSCRIPT);
/** the onset (s) of a word or phrase of the transcript: at("placeholder"), at("the words"), at("the", 2) */
const at = (phrase: string, nth = 1) => anchorOf(TL, phrase, nth);

// world positions shared by the plan and the scene
export const HERO: V3 = [0.2, 0.16, -2.6];
export const HEAD: V3 = headOf(HERO, CAST.adult.height, CAST.adult.build);

/** optional key words drawn in an accent color (captions are all white by default); leave empty for all white */
export const ACCENT_WORDS: string[] = [];

const s2 = at("replace");
export const SHOTS: Shot[] = [
  { id: "S01", from: 0, mood: "day", base: aim([1.6, 1.55, 1.9], HEAD, 46, 0.38), focus: HEAD, blur: 1.4, beats: beatsFor(TL, 0, s2) },
  { id: "S02", from: s2, mood: "golden", base: aim([-1.9, 1.5, 1.7], HEAD, 44, 0.38), focus: HEAD, blur: 1.6, beats: beatsFor(TL, s2, TL.duration) },
];
