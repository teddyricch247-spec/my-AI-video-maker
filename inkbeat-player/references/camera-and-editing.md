# Camera and editing

## The beat rig (Shorts)
Each plan beat is a **move from the current pose**; the pose at time t is folded from the setup's base lens through
the beats in order, so it is a pure function of t.

- Easing: symmetric ease-in-out cubic; PUNCH uses an ease-out.
- Default durations (s): PUSH 0.63, PULL 0.66, MACRO 0.6, ORBIT 0.7, CRANE 0.7, DOLLY 0.75, TILT 0.63, WHIP 0.27–0.3,
  PUNCH 0.2, SHAKE decays over 0.4. Big moves between distant framings: **0.85–1.0 s**.
- Typical amounts: PUSH 12–15% of the lens-to-look distance, PULL −16 to −22%, MACRO 30% or an explicit target lens,
  ORBIT 15–25° around the look point with a small roll bump (~3°), CRANE up/down a quarter of the distance with the
  look following partly, DOLLY sideways a quarter of the distance, WHIP a 25° pan (start the setup panned +25° so the
  whip lands on the subject), TILT ±14°, PUNCH 8–15% in 6 frames, SHAKE ≤ 0.3% of the width.
- **PUSH/ORBIT scale with |look − pos|**: keep the look point a few meters ahead of the lens (not 40 m away), or a
  "small" push flies the camera through the subject.
- Any beat may carry an explicit **target lens** (`to`) for moves between framings; check the whole path for geometry
  and empty frames.
- **Between beats the camera never stops:** a drift-push of ~3%/s of the distance plus a slow lateral arc (~1.5–3°/s)
  around the look point. Parallax keeps a hold alive without stronger zooms.
- Clamp the lens above the ground (y ≥ ~0.08 m) after every move.
- Moves start ~6 frames before their word.

## Transitions between setups (Shorts)
- **push-through:** the outgoing shot punches in (fov × 0.7) and blurs over 3 frames, then a 3-frame blurred
  cross-blend, then the incoming shot lands over 8 frames with a fov pull. A one-frame swap reads as a hard cut on a
  scene-change detector.
- **whip:** ±38° yaw with a 14 px blur, 4 frames on each side.
- **dissolve:** 14 frames, only for time jumps (flashbacks, "the next morning").
- **iris / hard cut:** only for a POV insert (a phone screen, a peephole) or a deliberate comic beat.

## Every framing
- **Reads at first glance:** a clear subject, the face visible and big enough, nothing blocking the face, a bright,
  colorful, high-contrast focal point; the framing tells its beat instantly.
- **Lens feel:** set shots at a vertical fov of **60–80°**, low hero shots 85–95°, face close-ups 40–50° (38–62°
  everywhere read telephoto-flat). About 40% low angles (lens 0.3–1.2 m high, tilted up 10–25°), about 20% high 3/4 or
  overhead; something near the lens in about half the shots; small dutch angles of 2–6° inside Shorts moves.
- **Big cartoon heads constrain the lens:** no over-the-shoulder lens through a head (a foreground head can cover a
  third of the frame). Plan lenses that clear the heads; inserts get their own lens in front of the body.
- **Inserts:** the object fills **45–60% of the frame height** on a bright, readable background, with the hand and
  sleeve visible, no dark blobs at the frame edges, held ≥ 2 s.
- **Foreground objects may frame a shot but never sweep across the subject** during a move (posts and frames sliding
  over a face read as flicker).

## Retention beats
- Re-hook each sequence opening with a strong visual.
- Visual gags land exactly on the narration's punchlines.
- The last line gets a visual payoff, never a plain hold.

## Vertical framing
- The subject in the upper part: faces at **30–45%** of the height, captions own the area around **70%**.
- Helper: a lens at `from`, aimed so a subject point sits at fraction `face` from the top: `look.y = subject.y −
  tan((0.5 − face) · fov) · distance`.
- A table-height people framing aims ~0.4 m higher, at the faces; a low object (a hand, a menu) is centered lower and
  wider.
- Reusing a 16:9 staging vertically: re-aim at the shot's focus with vertical fov ×1.4.
