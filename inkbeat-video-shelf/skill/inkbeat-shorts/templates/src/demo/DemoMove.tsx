// A moving shot with the beat rig and motion blur. DemoMove renders at 30 fps (sharp). DemoMoveSub renders SUB
// sub-frames per output frame over a 180° shutter; average them with ffmpeg tmix (see core/frame.tsx) for real blur.
// Captions are keyed to the OUTPUT frame, so text stays sharp.
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CAST } from "../inkbeat/char/cast";
import { Character3D, headOf } from "../inkbeat/char/Character3D";
import { Captions, makeChunks } from "../inkbeat/core/captions";
import type { Word } from "../inkbeat/core/captions";
import { CastLight } from "../inkbeat/core/castLight";
import { subFrame, useFonts } from "../inkbeat/core/frame";
import { moodOf } from "../inkbeat/core/moods";
import { aim, poseAt, withShake } from "../inkbeat/core/rig";
import type { Beat } from "../inkbeat/core/rig";
import { View } from "../inkbeat/core/View";
import type { V3 } from "../inkbeat/types";
import { Street } from "./Street";

const HERO: V3 = [0.2, 0.16, -2.6];
const ADULT = CAST.adult;
const HEAD: V3 = headOf(HERO, ADULT.height, ADULT.build);
// beats sit ON words: a slow drift, a push on "here", a punch on "now"
const WORDS: Word[] = [["Look", 0.2, 0.5], ["over", 0.55, 0.8], ["here", 0.85, 1.3], ["right", 1.6, 1.9], ["now", 1.95, 2.4]];
const BEATS: Beat[] = [
  { t: 0.85, move: "PUSH", dur: 0.63, word: "here" },
  { t: 1.95, move: "PUNCH", dur: 0.2, word: "now" },
];
const CHUNKS = makeChunks(WORDS, 3);
export const MOVE_FRAMES = 90;

export const DemoMove: React.FC<{ sub?: boolean }> = ({ sub = false }) => {
  const ready = useFonts();
  const g = useCurrentFrame();
  if (!ready) return <AbsoluteFill style={{ background: "#1a1220" }} />;
  const { n, fp } = sub ? subFrame(g) : { n: g, fp: g };
  const t = fp / 30;
  const base = aim([2.6, 1.7, 3.4], HEAD, 50, 0.38);
  const p = poseAt(base, BEATS, 0, t, [{ frac: 0.25 }, { frac: 0.12 }]);
  const cam = withShake(p, p.shake);
  const m = moodOf("dusk");
  return (
    <AbsoluteFill style={{ background: "#1a1220" }}>
      <View mood={m} cam={cam} t={t} focus={HEAD} blur={1.4}>
        <Street lamp={1} />
        <Character3D
          {...ADULT}
          position={HERO}
          yaw={0.45 + Math.sin(t * 1.3) * 0.08}
          t={t}
          face={{ eyes: t > 1.95 ? "wide" : "open", mouth: t > 1.95 ? "o" : "smile", brows: "raised" }}
          pose={{ armL: [10, 10], armR: [46 + Math.sin(t * 3) * 10, 64], armRFwd: 34, headTilt: -4, bob: Math.sin(t * 4) * 3 }}
          faceCamera={cam.pos}
        />
        <CastLight at={HEAD} cam={cam.pos} mood={m} />
      </View>
      <Captions chunks={CHUNKS} t={n / 30} accent={new Set(["now"])} />
    </AbsoluteFill>
  );
};
