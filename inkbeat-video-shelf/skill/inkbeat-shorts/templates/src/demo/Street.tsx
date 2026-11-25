// A small dressed street corner: a guide for set density and materials. Every surface has a painted texture
// (plaster, brick, planks, roof tiles, stone, wood, metal, fabric), walls never share a face (≥ 1 cm offsets), window
// bars only touch, there is dressing in three depth layers (foreground props, the character's ground, the facades),
// and ONE warm practical. Signs: only on a key object, never on everything.
import React from "react";
import * as THREE from "three";
import { boxG, coreMat, cylG, Label, M, sphG } from "../inkbeat/core/kit";
import type { V3 } from "../inkbeat/types";

export const Window: React.FC<{ p: V3; w?: number; h?: number; frame?: string; lit?: boolean }> = ({ p, w = 0.9, h = 1.2, frame = "#f2ead8", lit }) => (
  <group position={p}>
    <mesh geometry={boxG(w, h, 0.02)} material={coreMat(lit ? "#ffd38a" : "#3a4a7a", lit ? 1.0 : 0.75)} />
    {/* frame bars only touch (overlapping bars ink a flickering black blob) */}
    <M g={boxG(w + 0.1, 0.06, 0.05)} c={frame} p={[0, h / 2 + 0.03, 0.012]} />
    <M g={boxG(w + 0.1, 0.06, 0.05)} c={frame} p={[0, -h / 2 - 0.03, 0.012]} />
    <M g={boxG(0.06, h, 0.05)} c={frame} p={[-w / 2 - 0.02, 0, 0.012]} />
    <M g={boxG(0.06, h, 0.05)} c={frame} p={[w / 2 + 0.02, 0, 0.012]} />
    <M g={boxG(0.04, h, 0.04)} c={frame} p={[0, 0, 0.014]} />
    <M g={boxG(w + 0.24, 0.08, 0.18)} c="#c8b8a0" p={[0, -h / 2 - 0.1, 0.06]} />
  </group>
);

export const House: React.FC<{ p: V3; w: number; h: number; d: number; wall: string; tex: "plaster" | "brick" | "planks"; roof: string; yaw?: number; windows?: number; lit?: number[] }> = ({ p, w, h, d, wall, tex, roof, yaw = 0, windows = 2, lit = [] }) => (
  <group position={p} rotation={[0, yaw, 0]}>
    <M g={boxG(w, h, d)} c={wall} tex={tex} p={[0, h / 2, 0]} />
    <M g={boxG(w + 0.02, 0.6, d + 0.02)} c="#8a5a4a" tex="brick" p={[0, 0.3, 0]} />
    {[-1, 1].map((s) => (
      <M key={s} g={boxG(w + 0.6, 0.12, d * 0.62)} c={roof} tex="roofTiles" p={[0, h + d * 0.17, s * d * 0.25]} r={[s * 0.6, 0, 0]} />
    ))}
    <M g={boxG(w + 0.1, 0.22, 0.3)} c="#e8dcc8" p={[0, h - 0.05, d / 2 + 0.15]} />
    {Array.from({ length: windows }, (_, i) => (
      <Window key={i} p={[-w / 2 + (i + 0.5) * (w / windows), h * 0.62, d / 2 + 0.011]} lit={lit.includes(i)} />
    ))}
    <M g={boxG(1.0, 2.0, 0.08)} c="#5a3a2a" tex="planks" p={[w / 2 - 0.9, 1.0, d / 2 + 0.04]} />
  </group>
);

export const Crate: React.FC<{ p: V3; s?: number; yaw?: number }> = ({ p, s = 0.6, yaw = 0 }) => (
  <group position={p} rotation={[0, yaw, 0]}>
    <M g={boxG(s, s, s)} c="#c8945a" tex="planks" p={[0, s / 2, 0]} />
    <M g={boxG(s + 0.02, 0.06, s + 0.02)} c="#8a5a32" p={[0, s * 0.82, 0]} />
    <M g={boxG(s + 0.02, 0.06, s + 0.02)} c="#8a5a32" p={[0, s * 0.18, 0]} />
  </group>
);

export const Barrel: React.FC<{ p: V3 }> = ({ p }) => (
  <group position={p}>
    <M g={cylG(0.32, 0.3, 0.9, 20)} c="#b8743a" tex="wood" p={[0, 0.45, 0]} />
    {[0.15, 0.75].map((y) => (
      <M key={y} g={cylG(0.335, 0.335, 0.05, 20)} c="#4a4a52" tex="metal" p={[0, y, 0]} />
    ))}
  </group>
);

export const LampPost: React.FC<{ p: V3; on?: number }> = ({ p, on = 1 }) => (
  <group position={p}>
    <M g={cylG(0.06, 0.08, 3.2, 12)} c="#2a3238" tex="metal" p={[0, 1.6, 0]} />
    <M g={cylG(0.18, 0.12, 0.08, 12)} c="#2a3238" p={[0, 3.25, 0]} />
    <mesh geometry={sphG(0.14, 16)} material={coreMat("#ffd890", 0.6 + 0.5 * on)} position={[0, 3.12, 0]} />
    <pointLight position={[0, 3.0, 0.2]} color="#ffb860" intensity={6 * on} distance={7} decay={2} />
  </group>
);

export const Awning: React.FC<{ p: V3; w: number; color: string }> = ({ p, w, color }) => (
  <group position={p}>
    {Array.from({ length: 7 }, (_, i) => (
      <M key={i} g={boxG(w / 7, 0.04, 1.0)} c={i % 2 ? "#f4ead6" : color} tex="fabric" p={[-w / 2 + (i + 0.5) * (w / 7), 0, 0.45]} r={[0.35, 0, 0]} />
    ))}
  </group>
);

export const Planter: React.FC<{ p: V3 }> = ({ p }) => (
  <group position={p}>
    <M g={boxG(0.9, 0.45, 0.4)} c="#a85a3a" tex="brick" p={[0, 0.225, 0]} />
    {[-0.28, 0, 0.28].map((x, i) => (
      <M key={x} g={sphG(0.22 + (i % 2) * 0.05, 14)} c={i % 2 ? "#4a8a4a" : "#5aa04a"} p={[x, 0.55, 0]} />
    ))}
  </group>
);

/** the set; `shopSign` puts ONE sign on the shop (a key object), nothing else gets text */
export const Street: React.FC<{ shopSign?: string; lamp?: number }> = ({ shopSign = "BAKERY", lamp = 0 }) => (
  <group>
    <M g={boxG(60, 0.2, 60)} c="#8a8290" tex="stone" ts={1.5} p={[0, -0.1, 0]} cast={false} />
    <M g={boxG(30, 0.16, 3.2)} c="#c8bcae" tex="stone" p={[0, 0.08, -3.6]} cast={false} />
    <House p={[-3.6, 0.16, -7]} w={5} h={5.2} d={4} wall="#f0c89a" tex="plaster" roof="#9a4a3a" windows={2} lit={[1]} />
    <House p={[1.8, 0.16, -7.4]} w={5.4} h={6.4} d={4.2} wall="#b8604a" tex="brick" roof="#4a4a6a" windows={3} />
    <House p={[7.6, 0.16, -6.8]} w={5} h={4.6} d={4} wall="#9ab8c8" tex="plaster" roof="#7a3a3a" windows={2} />
    <House p={[-9.2, 0.16, -6.6]} w={5} h={5.8} d={4} wall="#e8dca8" tex="planks" roof="#5a4a6a" windows={2} />
    <Awning p={[1.8, 2.7, -5.3]} w={5.0} color="#c83a3a" />
    <Label text={shopSign} p={[1.8, 3.7, -5.05]} w={2.2} h={0.5} fg="#f4ead6" bg="#3a2a4a" font={0.6} />
    <LampPost p={[-1.2, 0.16, -2.4]} on={lamp} />
    <Crate p={[3.6, 0.16, -4.6]} yaw={0.3} />
    <Crate p={[4.2, 0.16, -4.4]} s={0.45} yaw={-0.2} />
    <Crate p={[3.85, 0.76, -4.55]} s={0.4} yaw={0.6} />
    <Barrel p={[-2.6, 0.16, -4.4]} />
    <Planter p={[-5.0, 0.16, -4.6]} />
    {/* foreground props close to the lens: depth (they fall into the mild depth of field) */}
    <Crate p={[2.4, 0, 2.2]} s={0.55} yaw={0.5} />
    <M g={cylG(0.05, 0.05, 1.1, 10)} c="#2a3238" tex="metal" p={[-2.2, 0.55, 2.6]} />
  </group>
);
void THREE;
