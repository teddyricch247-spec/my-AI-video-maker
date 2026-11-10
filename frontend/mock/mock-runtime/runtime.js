// FAKE ENGINE for the mock server. Not the real vbeat engine.
// It implements the interface web/js/preview-adapter.js assumes:
//   createRuntime({canvas, spec, baseUrl, sceneUrl}) -> { drawFrame(t, scale), markers(), info:{fps, frames, dur} }   (same shape as the real engine/runtime/runtime.js)
// It deliberately exercises the same cross-origin paths the real engine will:
//   - imports an asset module from baseUrl            (needs CORS on /runtime/assets/*)
//   - imports the AI-written scene module sceneUrl    (needs CORS on /preview/scene/*)
//   - loads a project image with crossOrigin=anonymous (needs CORS on /files/media/*; canvas stays readable)
// All of that runs inside a sandboxed iframe with an opaque origin and no cookies.

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = new URL(url, location.href).href;
  });
}

export async function createRuntime({ canvas, spec, baseUrl, sceneUrl }) {
  const shapes = await import(new URL(baseUrl + 'shapes.js', location.href).href);
  const scene = await import(new URL(sceneUrl, location.href).href);
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext('2d');
  let logo = null;
  canvas.dataset.media = 'none';
  if (spec.logo_url) {
    try {
      logo = await loadImage(spec.logo_url);
      canvas.dataset.media = 'ok';
    } catch (e) {
      canvas.dataset.media = 'fail';
    }
  }
  const { fps, frames, dur } = spec;
  const flashes = spec.markers.filter((m) => m.kind === 'sfx');

  return {
    info: { fps, frames, dur },
    markers: () => spec.markers.map((m) => ({ id: m.id, t: m.t, kind: m.kind })),
    drawFrame(t, scale) {
      const w = canvas.width;
      const h = canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      scene.draw(ctx, t, w, h, spec, shapes); // may throw: the player must survive that
      if (logo) ctx.drawImage(logo, w - 190, 20, 170, 96);
      for (const m of flashes) {
        if (t >= m.t && t < m.t + 0.12) {
          ctx.fillStyle = 'rgba(255,255,255,' + (0.55 * (1 - (t - m.t) / 0.12)).toFixed(3) + ')';
          ctx.fillRect(0, 0, w, h);
        }
      }
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(0, h - 44, 330, 44);
      ctx.fillStyle = '#fff';
      ctx.font = '600 24px monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText('f' + Math.round(t * fps) + '  t=' + t.toFixed(2) + 's', 14, h - 22);
    },
  };
}
