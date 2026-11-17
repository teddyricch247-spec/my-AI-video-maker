// Multi-pass post-processing pipeline. No external post libraries.
//
// Per frame:
//   1. color pass    : scene -> sceneRT (HalfFloat, MSAA x4), linear light, no tone mapping
//   2. normal pass   : scene with per-object MeshNormalMaterial -> normalRT (+ float DepthTexture)
//                      (transparent / sprite / point / line objects are hidden; custom
//                      ShaderMaterials keep their vertex shader and write a flat normal)
//   3. edge pass     : depth 2nd-derivative + normal creases -> 1px edge mask + distance fade
//   4. ink pass      : dilate edges into AA lines, darken color; write signed CoC into alpha
//   5. DOF pass      : golden-angle scatter-as-gather blur
//   6. bloom         : prefilter + 13-tap downsample chain + tent upsample
//   7. final         : bloom add, exposure, shoulder, sRGB, contrast, LGG, sat, split tone,
//                      vignette, paper grain, dither -> canvas (alpha = 1)
import * as THREE from "three";
import {
  BLOOM_PREFILTER_FRAG,
  DOF_FRAG,
  dofTaps,
  DOWN_FRAG,
  EDGE_FRAG,
  FINAL_FRAG,
  FLAT_NORMAL_FRAG,
  FULLSCREEN_VERT,
  INK_FRAG,
  UP_FRAG,
} from "./shaders";
import type { PostSettings } from "./PostFX";

const BLOOM_LEVELS = 7;

export const hexToRgb = (hex: string): [number, number, number] => {
  const c = new THREE.Color();
  // parse as-is (display values), no color management
  const h = hex.trim();
  if (/^#([0-9a-f]{3}){1,2}$/i.test(h)) {
    let s = h.slice(1);
    if (s.length === 3) s = s.split("").map((x) => x + x).join("");
    return [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255];
  }
  c.setStyle(h, THREE.SRGBColorSpace);
  const t = { r: 0, g: 0, b: 0 };
  c.getRGB(t, THREE.SRGBColorSpace);
  return [t.r, t.g, t.b];
};
const v3 = (a: [number, number, number]) => new THREE.Vector3(a[0], a[1], a[2]);

type Mat = THREE.ShaderMaterial;
const mkMat = (frag: string, uniforms: Record<string, THREE.IUniform>): Mat =>
  new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

const halfRT = (w: number, h: number, opts: Partial<THREE.RenderTargetOptions> = {}) =>
  new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    ...opts,
  });

export class PostPipeline {
  w = 0;
  h = 0;
  sceneRT!: THREE.WebGLRenderTarget;
  normalRT!: THREE.WebGLRenderTarget;
  edgeRT!: THREE.WebGLRenderTarget;
  inkRT!: THREE.WebGLRenderTarget;
  dofRT!: THREE.WebGLRenderTarget;
  down: THREE.WebGLRenderTarget[] = [];
  up: THREE.WebGLRenderTarget[] = [];

  quadScene = new THREE.Scene();
  quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quad: THREE.Mesh;

  edgeMat: Mat;
  inkMat: Mat;
  dofMat: Mat;
  preMat: Mat;
  downMat: Mat;
  upMat: Mat;
  finalMat: Mat;

  normalMats = new Map<number, THREE.MeshNormalMaterial>();
  flatMats = new WeakMap<THREE.ShaderMaterial, THREE.ShaderMaterial>();
  black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(geo);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.black.needsUpdate = true;

    const depthU = () => ({ uNear: { value: 0.1 }, uFar: { value: 1000 }, uPersp: { value: 1 } });
    this.edgeMat = mkMat(EDGE_FRAG, {
      tNormal: { value: null },
      tDepth: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uDepthThr: { value: 0.05 },
      uNormalThr: { value: 0.3 },
      uJump: { value: 1 },
      uIdEdge: { value: 0 },
      uFadeNear: { value: 20 },
      uFadeFar: { value: 150 },
      ...depthU(),
    });
    this.inkMat = mkMat(INK_FRAG, {
      tScene: { value: null },
      tEdge: { value: null },
      tDepth: { value: null },
      tBloom: { value: this.black },
      uTexel: { value: new THREE.Vector2() },
      uOutline: { value: 1 },
      uInk: { value: new THREE.Vector3() },
      uWidth: { value: 2.5 },
      uStrength: { value: 1 },
      uFarWidth: { value: 0.5 },
      uFarOpacity: { value: 0.45 },
      uDof: { value: 1 },
      uFocus: { value: 8 },
      uFocusRange: { value: 20 },
      uMaxBlur: { value: 10 },
      uBloom: { value: 0 },
      uBloomTint: { value: new THREE.Vector3(1, 1, 1) },
      uExposure: { value: 0 },
      uContrast: { value: 1 },
      uSaturation: { value: 1 },
      uLift: { value: new THREE.Vector3(0, 0, 0) },
      uGamma: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
      uGain: { value: new THREE.Vector3(1, 1, 1) },
      uShadowTint: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
      uHighTint: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
      uSplit: { value: 0 },
      uWobble: { value: 0.35 },
      uSS: { value: 2 },
      uSSOff: { value: 0.5 },
      uSharpen: { value: 0 },
      uRes: { value: new THREE.Vector2(1080, 1920) },
      ...depthU(),
    });
    this.dofMat = mkMat(DOF_FRAG, {
      tColor: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uMaxBlur: { value: 10 },
      uTaps: { value: dofTaps() },
    });
    this.preMat = mkMat(BLOOM_PREFILTER_FRAG, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: 0.9 },
      uKnee: { value: 0.3 },
    });
    this.downMat = mkMat(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat = mkMat(UP_FRAG, {
      tLow: { value: null },
      tHigh: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uScatter: { value: 0.7 },
    });
    this.finalMat = mkMat(FINAL_FRAG, {
      tColor: { value: null },
      uVigAmount: { value: 0 },
      uVigSoft: { value: 0.5 },
      uVigColor: { value: new THREE.Vector3(0, 0, 0) },
      uGrain: { value: 0 },
      uFrame: { value: 0 },
      uRes: { value: new THREE.Vector2() },
    });
  }

  ss = 2;
  private alloc(w: number, h: number, ss: number) {
    if (w === this.w && h === this.h && ss === this.ss && this.sceneRT) return;
    this.ss = ss;
    this.disposeTargets();
    this.w = w;
    this.h = h;
    this.sceneRT = halfRT(w, h, { depthBuffer: true, samples: 4 });
    const depthTex = new THREE.DepthTexture(w * ss, h * ss, THREE.FloatType);
    this.normalRT = new THREE.WebGLRenderTarget(w * ss, h * ss, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      depthTexture: depthTex,
    });
    this.edgeRT = new THREE.WebGLRenderTarget(w * ss, h * ss, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    });
    this.inkRT = halfRT(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.dofRT = halfRT(w, h);
    this.down = [];
    this.up = [];
    let lw = w,
      lh = h;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      lw = Math.max(1, Math.round(lw / 2));
      lh = Math.max(1, Math.round(lh / 2));
      this.down.push(halfRT(lw, lh));
      this.up.push(halfRT(lw, lh));
    }
  }

  private disposeTargets() {
    [this.sceneRT, this.normalRT, this.edgeRT, this.inkRT, this.dofRT, ...this.down, ...this.up].forEach((t) => {
      if (!t) return;
      t.depthTexture?.dispose();
      t.dispose();
    });
  }

  dispose() {
    this.disposeTargets();
    [this.edgeMat, this.inkMat, this.dofMat, this.preMat, this.downMat, this.upMat, this.finalMat].forEach((m) => m.dispose());
    this.normalMats.forEach((m) => m.dispose());
    this.quad.geometry.dispose();
    this.black.dispose();
  }

  private blit(gl: THREE.WebGLRenderer, mat: Mat, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    gl.setRenderTarget(target);
    gl.render(this.quadScene, this.quadCam);
  }

  private normalMatFor(side: THREE.Side, flat: boolean): THREE.MeshNormalMaterial {
    const key = side * 2 + (flat ? 1 : 0);
    let m = this.normalMats.get(key);
    if (!m) {
      m = new THREE.MeshNormalMaterial({ side, flatShading: flat });
      this.normalMats.set(key, m);
    }
    return m;
  }

  /** with outline.idEdges: one normal material per object, its id in alpha (0.52..0.99; > 0.5 keeps the "geometry
   * here" mask), so the edge pass can ink every boundary between two objects solidly, without depending on a depth
   * threshold. Same shader program for all of them (only the opacity uniform differs). */
  private idMats = new Map<string, THREE.MeshNormalMaterial>();
  private idMatFor(side: THREE.Side, flat: boolean, objId: number): THREE.MeshNormalMaterial {
    // keyed by the id's alpha step (120 values), not the object: sets remount every shot, so a per-object cache
    // would grow without bound (Chrome runs out of memory)
    const step = Math.round(((objId * 0.6180339887) % 1) * 119) + 1;
    const key = `${side}:${flat ? 1 : 0}:${step}`;
    let m = this.idMats.get(key);
    if (!m) {
      // transparent + NoBlending: three only writes the material alpha when the material is not "OPAQUE" (an opaque material
      // forces alpha 1); NoBlending writes it straight, depthWrite stays on
      m = new THREE.MeshNormalMaterial({ side, flatShading: flat, transparent: true, blending: THREE.NoBlending });
      m.opacity = 0.52 + step / 255;
      this.idMats.set(key, m);
    }
    return m;
  }

  /** with outline.clothFlat: double-sided surfaces (curtains, cloth, paper, leaves) get one flat normal in the normal
   * pass. Their folds flip front/back facing row by row of the mesh, which inks as a dotted line that crawls; now
   * only their silhouettes (depth / object id) are inked. */
  private clothMats = new Map<number, THREE.MeshBasicMaterial>();
  private clothMatFor(objId: number): THREE.MeshBasicMaterial {
    const step = objId >= 0 ? Math.round(((objId * 0.6180339887) % 1) * 119) + 1 : 0;
    let m = this.clothMats.get(step);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, blending: THREE.NoBlending, toneMapped: false });
      m.color.setRGB(0.5, 0.5, 1.0, THREE.LinearSRGBColorSpace);
      m.opacity = step ? 0.52 + step / 255 : 1;
      this.clothMats.set(step, m);
    }
    return m;
  }

  private flatMatFor(src: THREE.ShaderMaterial): THREE.ShaderMaterial {
    let m = this.flatMats.get(src);
    if (!m) {
      m = new THREE.ShaderMaterial({
        vertexShader: src.vertexShader,
        fragmentShader: FLAT_NORMAL_FRAG,
        uniforms: src.uniforms,
        defines: src.defines,
        side: src.side,
        glslVersion: src.glslVersion,
      });
      // RawShaderMaterial sources need their own precision header; fall back to a plain
      // vertex shader for those
      this.flatMats.set(src, m);
    }
    return m;
  }

  /** decide what an object looks like in the normal/depth pass */
  private outlineMaterial(mat: THREE.Material, objId = -1, clothFlat = false): THREE.Material | null {
    if (!mat.visible) return null;
    if (mat.transparent || !mat.depthWrite || !mat.colorWrite) return null;
    if ((mat as THREE.SpriteMaterial).isSpriteMaterial || (mat as THREE.PointsMaterial).isPointsMaterial) return null;
    if ((mat as THREE.LineBasicMaterial).isLineBasicMaterial) return null;
    if ((mat as THREE.RawShaderMaterial).isRawShaderMaterial) return null;
    // inverted-hull outlines (BackSide unlit shells) would double the ink: skip them
    if ((mat as THREE.MeshBasicMaterial).isMeshBasicMaterial && mat.side === THREE.BackSide) return null;
    if ((mat as THREE.ShaderMaterial).isShaderMaterial) return this.flatMatFor(mat as THREE.ShaderMaterial);
    if (mat.alphaTest > 0 && ((mat as THREE.MeshStandardMaterial).map || (mat as THREE.MeshStandardMaterial).alphaMap)) return null;
    const flat = !!(mat as THREE.MeshStandardMaterial).flatShading;
    if (clothFlat && mat.side === THREE.DoubleSide) return this.clothMatFor(objId);
    return objId >= 0 ? this.idMatFor(mat.side, flat, objId) : this.normalMatFor(mat.side, flat);
  }

  render(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, s: PostSettings, frame: number) {
    const size = gl.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.floor(size.x));
    const h = Math.max(1, Math.floor(size.y));
    const ss = s.outline.supersample === 1 ? 1 : 2;
    this.alloc(w, h, ss);
    const scale = w / 1080; // settings are in px at 1080 width
    const texel = new THREE.Vector2(1 / w, 1 / h);

    const prevTarget = gl.getRenderTarget();
    const prevAutoClear = gl.autoClear;
    const prevClear = new THREE.Color();
    gl.getClearColor(prevClear);
    const prevAlpha = gl.getClearAlpha();
    const prevShadowAuto = gl.shadowMap.autoUpdate;
    gl.autoClear = true;

    // 1. color pass
    gl.setRenderTarget(this.sceneRT);
    gl.clear(true, true, true);
    gl.render(scene, camera);

    const cam = camera as THREE.PerspectiveCamera;
    const near = cam.near ?? 0.1;
    const far = cam.far ?? 1000;
    const persp = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? 1 : 0;

    const needDepth = s.outline.enabled || s.dof.enabled;
    if (needDepth) {
      // 2. normal + depth pass
      const swapped: { o: THREE.Mesh; m: THREE.Material | THREE.Material[] }[] = [];
      const minPx = s.outline.minPx ?? 0;
      let idN = 1;
      const pc = camera as THREE.PerspectiveCamera;
      const pxPerUnit = pc.isPerspectiveCamera ? (h / 2) / Math.tan((pc.fov * Math.PI) / 360) : 0;
      const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
      const tmpBox = new THREE.Box3();
      const tmpV = new THREE.Vector3();
      const tmpS = new THREE.Vector3();
      const thinPx = (o: THREE.Mesh) => {
        if (!pxPerUnit || !o.geometry) return Infinity;
        const g = o.geometry as THREE.BufferGeometry & { parameters?: Record<string, number> };
        if (!g.boundingBox) g.computeBoundingBox();
        o.getWorldScale(tmpS);
        const sc = Math.max(Math.abs(tmpS.x), Math.abs(tmpS.y), Math.abs(tmpS.z));
        const pr = g.parameters;
        let thick: number;
        if (pr && (pr.radius !== undefined || pr.radiusTop !== undefined) && pr.tubularSegments !== undefined) thick = 2 * pr.radius * sc; // tube
        else if (pr && pr.radiusTop !== undefined) thick = 2 * Math.max(pr.radiusTop, pr.radiusBottom ?? 0) * sc; // cylinder
        else {
          // a stick has TWO small extents (a sheet only one): the middle extent of the local box
          g.boundingBox!.getSize(tmpV);
          const e = [tmpV.x * Math.abs(tmpS.x), tmpV.y * Math.abs(tmpS.y), tmpV.z * Math.abs(tmpS.z)].sort((a, b) => a - b);
          thick = e[1];
        }
        tmpBox.copy(g.boundingBox!).applyMatrix4(o.matrixWorld);
        const d = Math.max(0.05, tmpBox.distanceToPoint(camPos));
        return (thick / d) * pxPerUnit;
      };
      const hidden: THREE.Object3D[] = [];
      scene.traverseVisible((o) => {
        const anyO = o as THREE.Mesh;
        if (o.userData && o.userData.outline === false) {
          hidden.push(o);
          return;
        }
        if ((o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) {
          hidden.push(o);
          return;
        }
        if (!anyO.isMesh) return;
        // sub-pixel-thin objects (a 3 cm stem 6 m away) rasterize as broken dashes in the depth/normal buffers and
        // their ink twinkles as soon as anything moves: no ink below outline.minPx of projected thickness
        if (minPx > 0 && thinPx(anyO) < minPx) {
          hidden.push(o);
          return;
        }
        const m = anyO.material;
        if (Array.isArray(m)) {
          const repl = m.map((x) => this.outlineMaterial(x, -1, !!s.outline.clothFlat));
          if (repl.every((x) => x === null)) {
            hidden.push(o);
            return;
          }
          swapped.push({ o: anyO, m });
          // null entries -> an invisible material
          anyO.material = repl.map((x) => x ?? HIDDEN_MAT);
        } else {
          // ids numbered in traversal order each frame (Object3D.id is a global counter: it differs per render tab)
          const r = this.outlineMaterial(m, (s.outline.idEdges ?? 0) > 0 ? idN++ : -1, !!s.outline.clothFlat);
          if (!r) {
            hidden.push(o);
            return;
          }
          swapped.push({ o: anyO, m });
          anyO.material = r;
        }
      });
      // hide after traversal (traverseVisible would skip children otherwise; that is fine)
      hidden.forEach((o) => (o.visible = false));
      const bg = scene.background;
      const fog = scene.fog;
      const env = scene.environment;
      scene.background = null;
      scene.fog = null;
      gl.shadowMap.autoUpdate = false;
      gl.setClearColor(0x8080ff, 0);
      gl.setRenderTarget(this.normalRT);
      gl.clear(true, true, true);
      gl.render(scene, camera);
      // restore
      swapped.forEach(({ o, m }) => (o.material = m));
      hidden.forEach((o) => (o.visible = true));
      scene.background = bg;
      scene.fog = fog;
      scene.environment = env;
      gl.shadowMap.autoUpdate = prevShadowAuto;
      gl.setClearColor(prevClear, prevAlpha);
    }

    const setDepthU = (m: Mat) => {
      m.uniforms.uNear.value = near;
      m.uniforms.uFar.value = far;
      m.uniforms.uPersp.value = persp;
    };

    // 3. edges
    if (s.outline.enabled) {
      const u = this.edgeMat.uniforms;
      u.tNormal.value = this.normalRT.texture;
      u.tDepth.value = this.normalRT.depthTexture;
      u.uTexel.value.set(1 / (w * ss), 1 / (h * ss));
      u.uDepthThr.value = s.outline.depthThreshold;
      u.uNormalThr.value = s.outline.normalThreshold;
      u.uJump.value = s.outline.jumpEdges ?? 1;
      u.uIdEdge.value = s.outline.idEdges ?? 0;
      u.uFadeNear.value = s.outline.fadeNear ?? 25;
      u.uFadeFar.value = s.outline.fadeFar ?? 160;
      setDepthU(this.edgeMat);
      this.blit(gl, this.edgeMat, this.edgeRT);
    }

    // 4. bloom from the HDR color pass
    let bloomTex: THREE.Texture = this.black;
    if (s.bloom.enabled && s.bloom.strength > 0) {
      const pu = this.preMat.uniforms;
      pu.tSrc.value = this.sceneRT.texture;
      pu.uTexel.value.copy(texel);
      pu.uThreshold.value = s.bloom.threshold;
      pu.uKnee.value = Math.max(0.05, s.bloom.threshold * 0.5);
      this.blit(gl, this.preMat, this.down[0]);
      const radius = Math.max(4, s.bloom.radiusPx * scale);
      // level i (0-based) is at 1/2^(i+1) resolution and blurs roughly 2^(i+2) px
      const levels = Math.max(2, Math.min(BLOOM_LEVELS, Math.ceil(Math.log2(radius / 2))));
      for (let i = 1; i < levels; i++) {
        const du = this.downMat.uniforms;
        du.tSrc.value = this.down[i - 1].texture;
        du.uTexel.value.set(1 / this.down[i - 1].width, 1 / this.down[i - 1].height);
        this.blit(gl, this.downMat, this.down[i]);
      }
      let low = this.down[levels - 1];
      for (let i = levels - 2; i >= 0; i--) {
        const uu = this.upMat.uniforms;
        uu.tLow.value = low.texture;
        uu.tHigh.value = this.down[i].texture;
        uu.uTexel.value.set(1 / low.width, 1 / low.height);
        uu.uScatter.value = s.bloom.scatter ?? 0.72;
        this.blit(gl, this.upMat, this.up[i]);
        low = this.up[i];
      }
      bloomTex = low.texture;
    }

    // 5. grade + ink + coc (display space)
    {
      const u = this.inkMat.uniforms;
      const g = s.grade;
      u.tScene.value = this.sceneRT.texture;
      u.tEdge.value = this.edgeRT.texture;
      u.tDepth.value = this.normalRT.depthTexture;
      u.tBloom.value = bloomTex;
      u.uTexel.value.copy(texel);
      u.uOutline.value = s.outline.enabled ? 1 : 0;
      u.uInk.value.copy(v3(hexToRgb(s.outline.color)));
      u.uWidth.value = Math.min(8.5, s.outline.widthPx * scale);
      u.uStrength.value = s.outline.strength;
      u.uFarWidth.value = s.outline.farWidth ?? 0.55;
      u.uFarOpacity.value = s.outline.farOpacity ?? 0.5;
      u.uDof.value = s.dof.enabled ? 1 : 0;
      u.uFocus.value = s.dof.focusDistance;
      u.uFocusRange.value = s.dof.focusRange;
      u.uMaxBlur.value = s.dof.maxBlurPx * scale;
      u.uBloom.value = s.bloom.enabled ? s.bloom.strength : 0;
      u.uBloomTint.value.copy(v3(hexToRgb(s.bloom.tint ?? "#ffffff")));
      u.uExposure.value = g.exposure;
      u.uContrast.value = g.contrast;
      u.uSaturation.value = g.saturation;
      u.uLift.value.copy(v3(hexToRgb(g.lift)));
      u.uGamma.value.copy(v3(hexToRgb(g.gamma)));
      u.uGain.value.copy(v3(hexToRgb(g.gain)));
      u.uShadowTint.value.copy(v3(hexToRgb(g.shadowTint)));
      u.uHighTint.value.copy(v3(hexToRgb(g.highlightTint)));
      u.uSplit.value = g.splitAmount;
      u.uWobble.value = s.outline.wobble ?? 0.35;
      u.uSS.value = ss;
      u.uSSOff.value = ss === 2 ? 0.5 : 0;
      u.uSharpen.value = g.sharpen ?? 0;
      u.uRes.value.set(w, h);
      setDepthU(this.inkMat);
      this.blit(gl, this.inkMat, this.inkRT);
    }
    let colorTex: THREE.Texture = this.inkRT.texture;

    // 6. DOF
    if (s.dof.enabled && s.dof.maxBlurPx > 0.3) {
      const u = this.dofMat.uniforms;
      u.tColor.value = this.inkRT.texture;
      u.uTexel.value.copy(texel);
      u.uMaxBlur.value = s.dof.maxBlurPx * scale;
      this.blit(gl, this.dofMat, this.dofRT);
      colorTex = this.dofRT.texture;
    }

    // 7. final: vignette, grain, dither -> canvas
    const fu = this.finalMat.uniforms;
    fu.tColor.value = colorTex;
    fu.uVigAmount.value = s.vignette.amount;
    fu.uVigSoft.value = s.vignette.softness;
    fu.uVigColor.value.copy(v3(hexToRgb(s.vignette.color)));
    fu.uGrain.value = s.grain;
    fu.uFrame.value = frame;
    fu.uRes.value.set(w, h);
    this.blit(gl, this.finalMat, null);

    gl.setRenderTarget(prevTarget);
    gl.autoClear = prevAutoClear;
  }
}

const HIDDEN_MAT = new THREE.MeshBasicMaterial({ visible: false });
