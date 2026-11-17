// Hand props for Character3D: mug, key, book, phone. Built in character units (h = 1); local +y points along the
// forearm, away from the elbow, and the origin is the hand center. Every prop is lit and inked like the character.
import React from "react";
import * as THREE from "three";
import { CLOTH } from "./family";
import { Inked } from "./Inked";
import { charMat } from "./material";

export type HandPropKind = "mug" | "key" | "book" | "phone";
export const HAND_PROPS: HandPropKind[] = ["mug", "key", "book", "phone"];

const rounded = (w: number, h: number, d: number, r: number) => {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: d * 0.2, bevelSize: Math.min(r * 0.5, d * 0.3), bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -d / 2);
  return g;
};

let geos: Record<string, THREE.BufferGeometry> | null = null;
const G = () => {
  if (geos) return geos;
  const cyl = (r0: number, r1: number, len: number, y: number, seg = 24) => {
    const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
    g.translate(0, y + len / 2, 0);
    return g;
  };
  // key: a round bow with a hole, a shaft, two bits
  const bow = new THREE.TorusGeometry(0.019, 0.0075, 12, 30);
  bow.translate(0, -0.022, 0);
  const shaft = cyl(0.0058, 0.0058, 0.072, -0.005, 14);
  const bit1 = new THREE.BoxGeometry(0.007, 0.018, 0.022);
  bit1.translate(0, 0.055, 0.013);
  const bit2 = new THREE.BoxGeometry(0.007, 0.01, 0.014);
  bit2.translate(0, 0.036, 0.01);
  // mug: a tapered body, a stripe, a handle, a drink surface
  const mug = cyl(0.034, 0.037, 0.075, -0.034, 28);
  const stripe = cyl(0.0372, 0.0378, 0.012, 0.016, 28);
  const drink = new THREE.CylinderGeometry(0.033, 0.033, 0.003, 28);
  drink.translate(0, 0.036, 0);
  const handle = new THREE.TorusGeometry(0.019, 0.0062, 10, 22, Math.PI * 1.25);
  handle.rotateZ(-Math.PI * 0.62);
  handle.translate(0.039, 0.003, 0);
  // book: covers, page block, a spine band
  const cover = rounded(0.1, 0.135, 0.022, 0.006);
  const pages = new THREE.BoxGeometry(0.093, 0.127, 0.019);
  pages.translate(0.004, 0, 0);
  const band = new THREE.BoxGeometry(0.008, 0.137, 0.024);
  band.translate(-0.046, 0, 0);
  // phone: a rounded slab, a screen, a camera dot (no brand)
  const phone = rounded(0.044, 0.088, 0.008, 0.008);
  const screen = rounded(0.038, 0.078, 0.001, 0.006);
  screen.translate(0, 0, 0.0052);
  const cam = new THREE.CylinderGeometry(0.0035, 0.0035, 0.002, 12);
  cam.rotateX(Math.PI / 2);
  cam.translate(0.01, 0.034, -0.0055);
  geos = { bow, shaft, bit1, bit2, mug, stripe, drink, handle, cover, pages, band, phone, screen, cam };
  return geos;
};

export const HandProp: React.FC<{ kind: HandPropKind }> = ({ kind }) => {
  const g = G();
  switch (kind) {
    case "key": {
      const metal = charMat(CLOTH.brass, { spec: 0.9, gloss: 0.5 });
      return (
        <group position={[0, 0.012, 0.018]}>
          <Inked geo={g.bow} mat={metal} ink={0.0042} />
          <Inked geo={g.shaft} mat={metal} ink={0.004} />
          <Inked geo={g.bit1} mat={metal} ink={0.0036} />
          <Inked geo={g.bit2} mat={metal} ink={0.0036} />
        </group>
      );
    }
    case "mug":
      return (
        <group position={[0, 0.01, 0.034]}>
          <Inked geo={g.mug} mat={charMat(CLOTH.cream, { spec: 0.6, gloss: 0.3 })} ink={0.0055} />
          <Inked geo={g.stripe} mat={charMat(CLOTH.teal, { spec: 0.5 })} ink={0} />
          <Inked geo={g.drink} mat={charMat("#6a3e28", { spec: 0.5, gloss: 0.4 })} ink={0} />
          <Inked geo={g.handle} mat={charMat(CLOTH.cream, { spec: 0.4 })} ink={0.0045} />
        </group>
      );
    case "book":
      return (
        <group position={[0, 0.03, 0.03]} rotation={[0.25, 0, 0]}>
          <Inked geo={g.cover} mat={charMat(CLOTH.brick, { spec: 0.25 })} ink={0.005} />
          <Inked geo={g.pages} mat={charMat(CLOTH.cream, { spec: 0.05 })} ink={0} />
          <Inked geo={g.band} mat={charMat(CLOTH.mustard, { spec: 0.3 })} ink={0.0035} />
        </group>
      );
    case "phone":
      return (
        <group position={[0, 0.03, 0.03]} rotation={[0.35, 0, 0]}>
          <Inked geo={g.phone} mat={charMat(CLOTH.graphite, { spec: 0.6, gloss: 0.4 })} ink={0.004} />
          <Inked geo={g.screen} mat={charMat("#1f3b5c", { spec: 0.8, gloss: 0.6, emissive: "#163049" })} ink={0} />
          <Inked geo={g.cam} mat={charMat("#101218", { spec: 1 })} ink={0} />
        </group>
      );
    default:
      return null;
  }
};
