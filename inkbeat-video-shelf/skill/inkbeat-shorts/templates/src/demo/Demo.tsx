// Demo: one character on a dressed street corner, all-white captions. `mood` switches the act light.
// DemoHero: the same in a low hero framing (shots.heroLow) with foreground props in the depth of field.
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CAST } from "../inkbeat/char/cast";
import { Character3D, headOf } from "../inkbeat/char/Character3D";
import { Captions, makeChunks } from "../inkbeat/core/captions";
import type { Word } from "../inkbeat/core/captions";
import { CastLight } from "../inkbeat/core/castLight";
import { useFonts } from "../inkbeat/core/frame";
import { moodOf } from "../inkbeat/core/moods";
import { aim } from "../inkbeat/core/rig";
import { heroLow } from "../inkbeat/core/shots";
import { View } from "../inkbeat/core/View";
import type { V3 } from "../inkbeat/types";
import { Crate, Street } from "./Street";

const HERO: V3 = [0.2, 0.16, -2.6];
const ADULT = CAST.adult;
const H = ADULT.height;
const FACING = 0.45;
const WORDS: Word[] = [
  ["Every", 0.0, 0.3],
  ["frame", 0.32, 0.6],
  ["is", 0.62, 0.7],
  ["drawn", 0.72, 1.1],
];
const CHUNKS = makeChunks(WORDS, 3);
export const DEMO_MOODS = ["day", "dusk", "night", "cold", "lamp", "golden"];

export const Demo: React.FC<{ mood?: string; wide?: boolean; hero?: boolean }> = ({ mood = "day", wide = false, hero = false }) => {
  const ready = useFonts();
  const f = useCurrentFrame();
  if (!ready) return <AbsoluteFill style={{ background: "#1a1220" }} />;
  const t = 0.8 + f / 30;
  const m = moodOf(mood);
  const head = headOf(HERO, H, ADULT.build);
  const shot = hero ? heroLow({ feet: HERO, height: H, facing: FACING, side: -32 }) : null;
  // a vertical lens: the face at ~38% of the height, so the captions at 70% never cover it
  const cam = shot ? shot.cam : wide ? aim([3.4, 2.2, 6.5], [0.6, 1.6, -3.5], 52, 0.4) : aim([1.6, 1.55, 1.9], head, 46, 0.38);
  return (
    <AbsoluteFill style={{ background: "#1a1220" }}>
      <View mood={m} cam={cam} t={t} focus={shot ? shot.focus : head} blur={shot ? shot.blur : wide ? 0.6 : 1.4}>
        <Street lamp={mood === "night" || mood === "lamp" || mood === "dusk" ? 1 : 0} />
        <Character3D
          {...ADULT}
          position={HERO}
          yaw={FACING}
          t={t}
          face={{ eyes: "open", mouth: "smile", brows: "raised", look: 0.2 }}
          pose={{ armL: [10, 10], armR: [62, 72], armRFwd: 34, headTilt: -4 }}
          faceCamera={cam.pos}
        />
        {shot ? (
          <>
            <Crate p={shot.fg[0]} s={0.4} yaw={0.4} />
            <Crate p={shot.fg[1]} s={0.32} yaw={-0.3} />
          </>
        ) : null}
        <CastLight at={head} cam={cam.pos} mood={m} />
      </View>
      <Captions chunks={CHUNKS} t={0.75} accent={new Set(["drawn"])} />
    </AbsoluteFill>
  );
};
