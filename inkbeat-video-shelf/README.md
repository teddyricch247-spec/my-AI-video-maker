# Inkbeat video shelf

A phone-friendly website that lists videos an AI agent has made in **two selectable styles**, in both **9:16 (Shorts)** and **16:9 (YouTube)**:

- **Mode 1 (`skill/inkbeat-shorts`) — 3D Cartoon:** toon-shaded Three.js worlds, inverted-hull ink outlines, rigged 3D characters, and moving 3D camera beats.
- **Mode 2 (`skill/inkbeat-paper`) — 2D Paper Motion:** warm flat-pastel 2D Canvas cutouts powered by 122 modular assets (12 rigged characters, 37 gestures, 17 props, 7 sky moods, interiors & live whiteboards, 10 vehicles, weather FX, 9 story scenes).

Tap a mode card to filter clips or copy a prompt starter, open any folder to play parts in order, and Download or Delete clips directly from your phone.

## How it works

1. You send the agent a **transcript with a timestamp on every word** (`0.112 - 0.176  If`) plus **reference photos** and/or a prompt—and pick **Mode 1 (3D Cartoon)** or **Mode 2 (2D Paper Motion)**. Say YouTube / 16:9 for long form; otherwise you get a 9:16 Short.
2. It reads `AGENTS.md` and the chosen skill (`inkbeat-shorts` or `inkbeat-paper`), writes a temporary scene in `/tmp/inkbeat-work/`, and **renders a draft in `/tmp/inkbeat-renders/`**. Nothing is written into the codebase or saved to Supabase yet, and it makes **no voice-over or music**.
3. 9:16 gets big 1–2 word captions on each word. 16:9 gets small full-sentence captions with only the spoken word highlighted.
4. A video longer than 30 seconds comes out as several parts (`part-01.mp4`, `part-02.mp4` ...), cut on pauses, that join seamlessly in your editor.
5. When you say **save**, the agent uploads the rendered MP4s to the `videos` bucket and the generated scene `.js` code to the `scenes` bucket on Supabase (files over 45 MB are re-encoded first; Mode 2 clips get `-paper` and 16:9 clips get `-16x9`), then clears `/tmp`.
6. This site lists whatever is in the `videos` bucket, grouped automatically into session folders and filterable by **3D** vs **2D Paper**.

Your phone never renders anything, and the codebase stays light.

## What's in here

```
AGENTS.md              rules for the AI agent (read this first)
README.md              this file
skill/inkbeat-shorts/  Mode 1: 3D Cartoon skill & built-in reference scenes
skill/inkbeat-paper/   Mode 2: 2D Paper Motion skill (122 assets + offline pipeline)
app/                   the website (Next.js, 2-mode deck + style filter + folders)
lib/supabase.js        reads/deletes from Supabase storage (server only)
lib/folders.js         groups saved session parts & parses 3D vs 2D Paper tags
config/shelf.json      the Supabase URL, publishable key and bucket names
supabase/setup.sql     SQL for the `videos` and `scenes` buckets and policies
scripts/               bucket check, upload, list, delete, and scenes sync
public/fonts/          Poppins, same font as the video captions
.env.example           optional overrides
```

## Setup

The `videos` bucket is already configured on Supabase project `inkbeat-video-shelf` (ref `oblzunlbkmifwbpqvzis`):

- `config/shelf.json` has the project URL, the publishable key, and both bucket names (`videos` and `scenes`).
- To enable saving generated `.js` scene files directly to Supabase, run **section 2** of `supabase/setup.sql` once in your Supabase **SQL Editor** (creates the `scenes` bucket and policies).
- To move to a new Supabase project later, run all of `supabase/setup.sql` there and update `config/shelf.json`.

Anyone holding the publishable key can upload or delete items in those buckets. That is intended for this shelf. To lock it down later, drop the open policies and use `SUPABASE_SERVICE_ROLE_KEY` as a secret instead.

Run the site: `npm install`, then `npm run dev` (port 3000). `npm run bucket` checks the connection, and `npm run scenes list` checks saved scene files.

## First message to send in AI Studio

```
Read AGENTS.md first and follow the matching skill (Mode 1: skill/inkbeat-shorts, Mode 2: skill/inkbeat-paper).
Run python3 skill/inkbeat-shorts/pipeline/doctor.py and python3 skill/inkbeat-paper/pipeline/doctor.py.
Show me both doctor outputs, then render a 3-second test in Mode 2:
python3 skill/inkbeat-paper/pipeline/make_video.py --scene paper_test --seconds 3 --mode draft --out /tmp/inkbeat-renders/test2d --no-qa
and tell me whether /tmp/inkbeat-renders/test2d/video.mp4 exists and the seconds per frame.
```

Also paste this line into AI Studio's system instructions so it never forgets:

```
Read AGENTS.md and the chosen skill's START_HERE.md (inkbeat-shorts for Mode 1, inkbeat-paper for Mode 2) before any video task.
```

## Things to ask the agent

- "Make a 9:16 video in Mode 2 (2D Paper Motion) from this transcript..."
- "Make a 9:16 Short in Mode 1 (3D Cartoon) from this transcript and these photos."
- "Same video for YouTube, 16:9." (small sentence captions, calm cuts)
- "Render it final." (higher quality, slower)
- "Save it." (uploads all parts to `videos` with `-paper` for Mode 2, and scene code to `scenes`, then replies with Watch links)
- "Render the office_demo scene in Mode 2 as a 9 second draft."
- "What's on the shelf?" or tap **Delete** right on any clip or folder in the website UI.

## Limits

- The sandbox has 2 CPUs and no GPU. Rendering is about 0.1 seconds per frame in `draft`, 0.2 in `fast`, and 1 in `final`. A 30 second clip is 900 frames, so about 1.5, 3, and 15 minutes. Start with `draft`.
- Long renders can get cancelled. Ask the agent to run the same command again and it picks up where it stopped. If it changed the scene or your transcript meanwhile, old frames are thrown away automatically.
- Supabase's free tier allows 50 MB per file. Saving handles that: a file over 45 MB is re-encoded with ffmpeg (libx264, CRF 23, same resolution, audio copied untouched), slightly lower quality that only shows on very fine detail.
- The free plan allows 2 active Supabase projects. If one is paused, restore it in the dashboard before using it.
- Videos over 30 seconds are cut into equal parts automatically; each part stays under the size limit.
- The skill needs a word-by-word transcript with timestamps to sync captions. Without one, the agent uses `--seconds` and the scene's own words.
- The skill never makes a voice-over. Sound effects only if asked, as a separate stem.

## Credits and licenses

- The skill in `skill/inkbeat-shorts/` is MIT licensed. See its `LICENSE` and `THIRD_PARTY_NOTICES.md`.
- Poppins ExtraBold is licensed under the SIL Open Font License. The notice is in `public/fonts/OFL-Poppins.txt`.
