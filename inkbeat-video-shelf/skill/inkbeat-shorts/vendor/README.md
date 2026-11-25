# vendor/ — offline dependencies (no network or npm needed)
- `three-0.186.1.tgz`  original npm tarball of three@0.186.1 (MIT) — untouched, the source of everything below.
- `three/three.module.js`, `three/three.core.js`  the ES-module build (import via importmap, see pipeline/page.html).
- `three/addons/`  copied from the tarball's examples/jsm: postprocessing, shaders, utils, geometries. Map `three/addons/` in the importmap.
- Need another addon (loaders, controls, ...)? `tar xzf three-0.186.1.tgz package/examples/jsm/<dir>` and copy it into `three/addons/`.
- Licence: three/LICENSE. Version pinned to match the skill's Remotion template (three@0.186.1).
