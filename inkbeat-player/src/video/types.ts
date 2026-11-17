import type { Beat, BeatPrm, Cam } from "../inkbeat/core/rig";
import type { V3 } from "../inkbeat/types";

/** the drawing-buffer size the player wants; spread it into <View {...view} /> */
export type ViewSize = { width: number; height: number; dpr: number };

/** One setup: a framing + a light. `from` is its start (s), derived from a transcript word (never typed). It ends where the
 *  next shot starts. Inside it the beat rig moves the camera (beats.ts builds the beats from the words). */
export type Shot = {
  id: string;
  from: number;
  /** day | dusk | night | cold | lamp | golden (src/inkbeat/core/moods.ts) */
  mood: string;
  /** the base lens: use aim(from, subject, fov, faceFraction) or a preset from core/shots.ts */
  base: Cam;
  /** the subject point (depth of field) */
  focus: V3;
  /** max DOF blur px at 1080 wide: wide 0.6, medium 1.4, close 2.4, macro 3.0 */
  blur?: number;
  /** draw the sky dome (exteriors); false for interiors */
  sky?: boolean;
  /** extra exposure in stops */
  exposure?: number;
  beats: Beat[];
  prms?: (BeatPrm | undefined)[];
};
