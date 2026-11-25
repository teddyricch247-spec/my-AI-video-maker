// DemoCast: the three example characters (char/cast.ts) side by side on a plain painted floor, one light, one lens.
// Use it as the family sheet: every character you add should sit in this row without looking out of place.
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { CAST } from "../inkbeat/char/cast";
import { Character3D, headOf } from "../inkbeat/char/Character3D";
import { CastLight } from "../inkbeat/core/castLight";
import { useFonts } from "../inkbeat/core/frame";
import { M, boxG } from "../inkbeat/core/kit";
import { moodOf } from "../inkbeat/core/moods";
import { aim } from "../inkbeat/core/rig";
import { View } from "../inkbeat/core/View";
import type { V3 } from "../inkbeat/types";

const ROW: { key: keyof typeof CAST; p: V3; yaw: number; hold?: "mug" | "book" | null }[] = [
  { key: "elder", p: [-1.25, 0, 0], yaw: 0.35, hold: "book" },
  { key: "adult", p: [0, 0, 0.05], yaw: 0.1, hold: "mug" },
  { key: "kid", p: [1.15, 0, 0.1], yaw: -0.3 },
];

export const DemoCast: React.FC<{ mood?: string }> = ({ mood = "day" }) => {
  const ready = useFonts();
  const f = useCurrentFrame();
  if (!ready) return <AbsoluteFill style={{ background: "#1a1220" }} />;
  const t = 1.2 + f / 30;
  const m = moodOf(mood);
  const cam = aim([0.2, 1.25, 5.6], [0, 1.0, 0], 34, 0.5);
  const center: V3 = [0, 1.25, 0];
  return (
    <AbsoluteFill style={{ background: "#1a1220" }}>
      <View mood={m} cam={cam} t={t} focus={center} blur={0.4} width={1920} height={1080}>
        <M g={boxG(14, 0.1, 8)} c="#c9b89c" tex="planks" p={[0, -0.05, -1]} />
        <M g={boxG(14, 4, 0.2)} c="#9fb6c8" tex="plaster" p={[0, 2, -3.2]} />
        {ROW.map((r) => {
          const c = CAST[r.key];
          return (
            <Character3D
              key={r.key}
              {...c}
              position={r.p}
              yaw={r.yaw}
              t={t + r.p[0]}
              face={{ eyes: "open", mouth: r.key === "kid" ? "grin" : "smile", brows: r.key === "kid" ? "raised" : "neutral", blink: false }}
              pose={r.hold ? { armL: [8, 8], armR: [18, 92], armRFwd: 62 } : { armL: [14, 10], armR: [70, 60], armRFwd: 20 }}
              hold={r.hold ?? null}
              faceCamera={cam.pos}
            />
          );
        })}
        <CastLight at={headOf([0, 0, 0], CAST.adult.height, CAST.adult.build)} cam={cam.pos} mood={m} />
      </View>
    </AbsoluteFill>
  );
};
