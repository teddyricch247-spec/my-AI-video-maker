// ALL contact with the rendering engine lives in this one file. It runs INSIDE the sandboxed iframe.
//
// Bound to the real engine (engine/runtime/runtime.js; docs/CONTRACTS.md sections 3 and 9). The frontend builder had to
// assume this interface; the merge resolved every difference on THIS side (docs/MERGE_DECISIONS.md D1):
//
//   const mod = await import(bundle.runtime_url);
//   const eng = await mod.createRuntime({ canvas, spec, baseUrl: bundle.assets_base_url, sceneUrl: bundle.scene_url });
//   eng.drawFrame(t, scale)   // synchronous; t = beat-local seconds; scale = canvas pixels / 1280; throws SceneError{t}
//   eng.markers()             // [{id, t, kind}], throws MarkerError when the scene's markers() are invalid
//   eng.info.{fps, frames, dur}
//
// `spec` is the bundle's beat spec with `media` set to the bundle's id -> URL map (the runtime loads images from spec.media).
// If the engine's browser entry changes, change ONLY this file (and integration/test_preview_seam.py will tell you).

/** @returns {Promise<{dur:number, fps:number, frames:number, markers:Array<{id:string,t:number,kind:string}>, draw:(t:number)=>void}>} */
export async function loadEngine(bundle, canvas) {
  canvas.width = bundle.width;
  canvas.height = bundle.height;
  const mod = await import(bundle.runtime_url);
  const eng = await mod.createRuntime({
    canvas,
    spec: { ...bundle.spec, media: bundle.media },
    baseUrl: bundle.assets_base_url,
    sceneUrl: bundle.scene_url,
  });
  const scale = bundle.width / 1280; // the engine's logical canvas is 1280 x 720
  return {
    dur: eng.info.dur,
    fps: eng.info.fps,
    frames: eng.info.frames,
    markers: (eng.markers() || []).map((m) => ({ id: String(m.id), t: Number(m.t), kind: String(m.kind) })),
    draw: (t) => eng.drawFrame(t, scale),
  };
}
