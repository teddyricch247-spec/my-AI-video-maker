# Third-party notices

This skill's own files are under the MIT license in `LICENSE`. The items below are third-party code or assets included
in `templates/`, each under its own license. Their notices must be kept in copies and derived works.

| Item | Author | License | Used in |
|---|---|---|---|
| Hash without Sine | David Hoskins | MIT | `templates/src/inkbeat/post/shaders.ts` (2 copies), `templates/src/inkbeat/mat/materials.ts`, `templates/src/inkbeat/mat/sky.tsx` |
| three.js shader chunks (modified copies of `gradientmap_pars_fragment`, `map_fragment`, `lights_toon_pars_fragment`, `emissivemap_fragment` in the source, plus runtime string patches) | three.js authors | MIT | `templates/src/inkbeat/mat/materials.ts`, `templates/src/inkbeat/char/material.ts`, `templates/src/inkbeat/core/liquid.tsx`, `templates/src/inkbeat/core/shadows.ts` |
| Mulberry32 (JavaScript form as published by bryc) | Tommy Ettinger | CC0 1.0 (credited as a courtesy) | `templates/src/inkbeat/mat/paint.ts` |
| FNV-1a string hash | Glenn Fowler, Landon Curt Noll, Kiem-Phong Vo | Public domain (credited as a courtesy) | `templates/src/inkbeat/mat/paint.ts`, `templates/src/inkbeat/char/Character3D.tsx` |
| Poppins (fonts) | Indian Type Foundry | SIL Open Font License 1.1; see `templates/public/fonts/OFL-Poppins.txt`. Not covered by the MIT license. | `templates/public/fonts/` |

`core/shadows.ts` replaces three.js's interleaved gradient noise with 0.0 at runtime; no noise code is included.

Techniques that are implemented from a published description, with no code copied:
- the 13-tap downsample and the tent upsample in the bloom chain (J. Jimenez, 2014 presentation);
- the soft-knee bloom threshold (as in K. Takahashi's Kino Bloom; the code is original);
- the background-spread clamp in the depth-of-field gather (an idea from D. Gustafsson, "Bokeh depth of field in a
  single pass", 2018; the code is original).

---

## Hash without Sine

```
Copyright (c) 2014 David Hoskins.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## three.js

```
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Mulberry32

Mulberry32 is by Tommy Ettinger and is dedicated to the public domain under CC0 1.0
(https://creativecommons.org/publicdomain/zero/1.0/). No notice is required; it is credited here as a courtesy.

## FNV-1a

The FNV hash by Glenn Fowler, Landon Curt Noll and Kiem-Phong Vo is in the public domain. No notice is required; it
is credited here as a courtesy.

## Poppins

Poppins is copyright The Poppins Project Authors (Indian Type Foundry) and is licensed under the SIL Open Font
License, Version 1.1. The full license is in `templates/public/fonts/OFL-Poppins.txt`. It is not covered by this
skill's MIT license.
