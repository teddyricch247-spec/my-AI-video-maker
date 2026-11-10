# Style guide - technical ("paper") half

One look for every asset: flat paper-cut shapes, riso misregistration, halftone discs, multiply paper grain. Values come from `v2.html` and are exported by `assets/core/palette.js`.

## Palette tokens (never invent colours)
| token | hex | use |
|---|---|---|
| INK | #221E1A | outlines (4-5 px), text, thick lines; terminal window fill |
| PAPER | #F3EAD7 | scene background |
| CREAM | #FBF3E2 | card / chip / station fills |
| TOMATO | #E8452C | primary accent, big numerals, errors, highlighted item |
| MUSTARD | #F2B531 | secondary accent, highlighter, chips, coins |
| GREEN | #2F7D5B | success, "after", progress |
| PINK | #F2A3B5 | misregistration plate under headlines, soft accent |
| SHADOW | #CDBE9F | drop shadow (offset +4..+6 px, same shape) |
| AQUA / LEAF | #CFE6DC / #CFE3B8 | printed "map" ground inks (multiply), light fills |
`shade(hex, f)` is allowed for tints and darker variants of these. Anything else (including `rgba(34,30,26,a)` for ink at low alpha) must be a palette colour with alpha.

## Fonts (bundled in `assets/core/fonts/`, loaded by `assets/core/fonts.css`)
- **Lora** (SERIF, 700, often italic): headlines, big numerals, labels in diagrams.
- **Poppins** (SANS, 400-700): UI text, list items, body copy.
- **DejaVu Sans Mono** (MONO, 700): kickers (letter-spaced caps), badges, chips, code, captions.
Always call `await fontsReady()` before the first draw. Minimum text size 14 px; all text through `txt()` (or `fit()` for user-supplied strings); stay inside a 20 px safe margin (scenes keep content at x 80-1200).

## Anatomy of a technical scene
1. Paper fill + ground inks in multiply (`frame()`), kicker (red square + spaced mono caps) top-left at (80, 78).
2. Headline in Lora 700 italic with a pink misregistered copy offset (+4, +4) (`headline()`); big numerals get a tomato multiply plate (+7, +7) under an ink outline.
3. Content in cream cards with an ink outline (4 px) and a SHADOW copy offset (+5, +5).
4. `grainOver(g, .5)` last. No glow, no neon, no navy, no grid backgrounds, no brand logos.
Pass `bg: false` to any scene to get the content without background and grain (overlay on a story scene).

## Motion rules
- Easing: `eo` for slides/fades, `eio` for travel and drawing lines, `eb` (overshoot) for pops. Typical durations: fade .4-.5 s, pop .35-.5 s, line draw .6-1.4 s, stagger .1-.35 s.
- Every start time is a named anchor in `params.at`; defaults give the original timing. Read `meta.anchors`.
- Every asset ends in a readable settled state and keeps a subtle idle (bob of 2-4 px, breathing halftone, blinking caret, travelling packets). Valid for t = 0..15.
- Pure function of (t, params): seeded `rng()` only, no state between frames, secondary motion closed-form (sines, `exp` decay).
- `markers(params)` lists sound hit moments `{id, t, kind}`, kind in pop, tick, whoosh, thud, stamp, slide, chime, rustle.

## Do / Don't
- DO use one accent per idea (TOMATO to emphasise, MUSTARD to highlight, GREEN for good).
- DO keep 3-6 items per list/diagram; shorten text with the placeholder length in mind (short labels, <= 30 chars).
- DO give shapes a drop shadow and an ink outline; keep corners rounded.
- DON'T add gradients, blurs (`shadowBlur`/`filter` are forbidden), glows or photo textures.
- DON'T put text on a busy ground ink; text sits on PAPER or on cards.
- DON'T draw people, places, buildings, vehicles, plants, sky, terrain or weather here (story half).

## Technical vs story mode
`meta.mode = 'technical'`: paper look, flat, informational (this half's scenes). `'story'`: the warm "env" look with vignette, characters and sky (other half). `'both'`: icons and fx (`obj/*`, `fx/*`) work on either - they use the same palette and outlines, so drop them on top of a story scene too. For story scenes add `vignette(g, .24, '120,45,30')` and a softer grain (.4); technical scenes use grain .5 and no vignette.
