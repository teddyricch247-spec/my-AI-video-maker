# What the real backend must provide

Everything here was found by experiment (`python docs/experiments/run.py`, Chrome 153) or is a plain consequence of the contract.
The mock server (`mock/server.py`) sends exactly these headers and `tests/e2e.py` proves the preview works with them.

## 1. Sandboxed preview: exact headers

The scene code runs in `<iframe sandbox="allow-scripts" src="/preview-frame.html">` (no `allow-same-origin`). That gives the frame an
**opaque origin**. Measured consequences:

| Observation (experiment) | Consequence |
|---|---|
| Every sub-resource request from the frame carries `Origin: null`, `Sec-Fetch-Mode: cors` (modules, fetch) or `no-cors` (plain images), `Sec-Fetch-Site: cross-site` | CORS applies to everything the frame loads |
| Module scripts and `fetch()` without `Access-Control-Allow-Origin` are blocked, even for the same host (variant `nocors`: the frame never starts) | **Required:** `Access-Control-Allow-Origin: *` |
| A module served as `text/plain` is rejected: "Expected a JavaScript-or-Wasm module script" (variant `badmime`) | **Required:** `Content-Type: text/javascript` (or `application/javascript`) for every `.js` |
| The frame's requests carry **no cookie** (`document.cookie` and `localStorage` throw SecurityError; subrequests have no `Cookie` header) | **Required:** every URL the frame loads must authorise itself without the session cookie |
| `fetch('/api/me')` from inside the frame is blocked by CORS (the mock sends no CORS headers on `/api/*`) | **Keep `/api/*` free of CORS headers**, so scene code cannot read the API |
| An `Image` without `crossOrigin` drawn to a canvas taints it (`getImageData` throws); with `crossOrigin="anonymous"` it stays readable if the response has ACAO | Media/asset images need `Access-Control-Allow-Origin: *` too if the engine reads pixels |
| With the frame served under `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src 'self'; ...` module import, fetch and images still work (variant `csp`) | CSP below is safe to send |

### Response headers

For **every** URL that the frame loads: `/preview-frame.html`, `/js/preview-frame.js`, `/js/preview-adapter.js`, `PreviewBundle.runtime_url`,
every module under `assets_base_url`, `scene_url`, every URL in `media`, and any image the engine loads:

```
Access-Control-Allow-Origin: *
Content-Type: text/javascript; charset=utf-8     (for .js; correct image/*, audio/* types otherwise)
```

For `/preview-frame.html` additionally (defence in depth; the iframe attribute is the real boundary):

```
Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'self'
```

* `style-src 'unsafe-inline'` is only for the one `<style>` tag in `preview-frame.html`.
* If the real engine compiles code at runtime (`new Function`, `eval`, WASM), `script-src` must add `'unsafe-eval'` / `'wasm-unsafe-eval'`. Not verifiable without the engine.
* Do not send `X-Frame-Options: DENY` for `/preview-frame.html` (SAMEORIGIN is fine; not tested).

Also sent by the mock but **not shown to be necessary** by any experiment: `Cross-Origin-Resource-Policy: cross-origin`, `X-Content-Type-Options: nosniff`, `Access-Control-Expose-Headers`. Harmless; drop them if unwanted.

### Cache headers

* Versioned assets (`scene_url` containing the scene version, `media`, `wav_url`, spectrograms): `Cache-Control: public, max-age=31536000, immutable` is safe **only if the URL changes with the version** (the mock keys scene and wav URLs by version number).
* `runtime_url`, `assets_base_url/*`, `/js/*`, `/preview-frame.html`: `Cache-Control: no-cache` (revalidate) unless they are content-hashed.
* `strip_url`: `no-cache` in the mock because its URL changes with `n`; either is fine.
* `/api/*`: `Cache-Control: no-store` (the poll must never be cached).

### URLs must be self-authorising

Because the frame sends no cookie, `runtime_url`, `assets_base_url`, `scene_url` and `media` URLs cannot rely on the session cookie. Use unguessable or signed
URLs (the contract says URLs are opaque, so a token query string is fine) or serve those paths publicly. The mock does not check cookies on `/files`, `/preview`, `/runtime`.
`wav_url`, `strip_url`, `spectrogram_url` and export links are loaded by the parent page (same origin, cookie sent), so cookie auth works for them.

## 2. Audio needs HTTP Range requests

Experiment: an `<audio>` pointed at a WAV served with `Accept-Ranges: none` (or no range support) reports `seekable.end(0) === 0` and `currentTime = 1.5` snaps back to 0.
With `Accept-Ranges: bytes` and `206 Partial Content` it seeks (`seekable.end = 3`, `currentTime = 1.5`).
**Required for `wav_url` (and recommended for the sfx `wav_url`s): `Accept-Ranges: bytes`, answer `Range: bytes=a-b` with `206` and `Content-Range`.**
Without it the player detects this, shows a note and plays silently on its own timer.

## 3. Multipart uploads

Verified in Chrome: field name `file`; a pasted text is sent as a `Blob` with filename `pasted.txt`; non-ASCII names arrive raw but a `"` in a filename arrives as `%22`
(so percent-decode the filename). A 300 KB file arrived with the right length and first bytes (not compared in full). Do not require a `Content-Type` on the part (the Blob has `text/plain`; images carry their type).

## 4. `rev` in `GET /projects/{pid}/status?rev=N`

The first call after opening a project sends `rev=0`. **A real project must never have `rev == 0`** (start at 1), otherwise the first response would be `changed:false` and the page would stay empty.

## 5. Preview engine interface (VERIFIED against the real engine in the merged repo)

`web/js/preview-adapter.js` (the only file that touches the engine) uses the engine's real browser entry, `engine/runtime/runtime.js`:

```js
const mod = await import(bundle.runtime_url);
const eng = await mod.createRuntime({ canvas, spec: { ...bundle.spec, media: bundle.media }, baseUrl: bundle.assets_base_url, sceneUrl: bundle.scene_url });
eng.drawFrame(t, scale)   // synchronous; t = beat-local seconds; scale = bundle.width / 1280; throws SceneError{t, message}
eng.markers()             // [{id, t, kind}]  kind in pop|tick|whoosh|thud|stamp|slide|chime|rustle
eng.info.fps, eng.info.frames, eng.info.dur
```

The runtime fetches `<assets_base_url>_index.json`, imports `<assets_base_url>assets/core/*.js`, the asset modules and `fonts.css` from there,
and the scene from `scene_url`. The URL layout the backend must serve is in docs/CONTRACTS.md section 9 (it is the render machine's local URL
space under a prefix); `vbeat_shared.preview` builds the bundle and lists the headers. `PreviewBundle.spec` is the engine beat spec without
server paths. `BeatDetail.words[].f0` is a *project-absolute* frame, so beat-local time = `(word.f0 - beat.f0) / fps`.
No `unsafe-eval` is needed: the real runtime does not compile code at run time.

## 6. Smaller server expectations

* `GET /sessions/{sid}/messages?after_seq=N` returns messages with `seq > N` **including later changes to `queued`**: the UI re-reads from the oldest still-queued user message so the "queued" badge can clear. If the server never flips `queued` back to false the badge disappears once a later message arrives.
* A beat in `status: running` may still serve its previous scene/sfx versions; the UI keeps showing the current version until `scene_n` or `sfx_n` changes.
* Export file URLs return `410` (any body) after `expires_at`; the UI hides links once `expires_at` has passed.
* `POST /api/login` must answer 401 on a wrong password (the UI shows an error instead of redirecting).
* The UI never calls `GET /api/me` (the first real call reveals a 401 just as well and avoids an extra request).
