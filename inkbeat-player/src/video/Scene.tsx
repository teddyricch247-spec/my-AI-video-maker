// THE SCENE: the whole world and its actors as a pure function of time t (seconds). No Math.random, Date or
// performance.now: the same t must always draw the same frame. Rebuild the world and the acting for every transcript.
import React from "react";
import { Street } from "../examples/Street";
import { CAST } from "../inkbeat/char/cast";
import { Character3D } from "../inkbeat/char/Character3D";
import { CastLight } from "../inkbeat/core/castLight";
import { moodOf } from "../inkbeat/core/moods";
import { View } from "../inkbeat/core/View";
import { speakingAt } from "../player/timing";
import { direct } from "./director";
import { HEAD, HERO, TL } from "./plan";
import type { ViewSize } from "./types";

export const Scene: React.FC<{ t: number; view: ViewSize }> = ({ t, view }) => {
  const d = direct(t);
  const m = moodOf(d.mood);
  const talking = speakingAt(TL, t);
  // a mouth that opens and closes at 2 Hz while its words are spoken (faster cycles read as flicker)
  const mouth = talking && Math.floor(t * 4) % 2 === 0 ? "open" : "smile";
  return (
    <View {...view} mood={m} cam={d.cam} t={t} focus={d.focus} blur={d.blur} sky={d.sky} exposure={d.exposure}>
      <Street lamp={d.mood === "night" || d.mood === "dusk" ? 1 : 0} />
      <Character3D
        {...CAST.adult}
        position={HERO}
        yaw={0.45 + Math.sin(t * 1.3) * 0.06}
        t={t}
        face={{ eyes: "open", mouth, brows: "raised", look: 0.2 }}
        pose={{ armL: [10, 10], armR: [46 + Math.sin(t * 2) * 8, 64], armRFwd: 34, headTilt: -4, bob: Math.sin(t * 2) * 2 }}
        faceCamera={d.cam.pos}
      />
      <CastLight at={HEAD} cam={d.cam.pos} mood={m} />
    </View>
  );
};
