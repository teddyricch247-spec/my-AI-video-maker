# Inkbeat video shelf

A phone-friendly website that lists the 3D cartoon videos an AI agent has made, in 9:16 (Shorts) and 16:9 (YouTube). Tap a clip to play it, tap Download to save it.

The agent (Google AI Studio) makes the videos in its own sandbox using the **inkbeat-shorts** skill, which is bundled in `skill/`. AI Studio can't load Claude skills natively, so `AGENTS.md` tells the agent where the skill is and how to use it.

## How it works

1. You send the agent a **transcript with a timestamp on every word** (`0.112 - 0.176  If`) plus **reference photos** and/or a prompt. Say YouTube / 16:9 for long form; otherwise you get a 9:16 Short.
2. It reads `AGENTS.md` and the skill, writes a temporary scene in `/tmp/inkbeat-work/` and **renders a draft in `/tmp/inkbeat-renders/`**. Nothing is written into the codebase or saved to Supabase yet, and it makes **no voice-over**: you record that in your own editor.
3. 9:16 gets big 1-2 word captions on each word. 16:9 gets small full-sentence captions with only the spoken word highlighted.
4. A video longer than 30 seconds comes out as several parts (`part-01.mp4`, `part-02.mp4` ...), cut on pauses, that join seamlessly in your editor.
5. When you say **save**, the agent uploads the rendered MP4s to the `videos` bucket and the generated scene `.js` code to the `scenes` bucket on Supabase (a file over 45 MB is re-encoded first so it stays under the 50 MB limit), then clears `/tmp`. 16:9 files are named `...-16x9...` so this site shows them landscape.
6. This site lists whatever is in the `videos` bucket, grouped automatically into session folders. Each clip has **Download** and **Delete** buttons so you can save what you want and clean up the rest directly from the shelf.

Your phone never renders anything, and the codebase stays light.

## What's in here

```
AGENTS.md              rules for the AI agent (read this first)
README.md              this file
skill/inkbeat-shorts/  the core skill & built-in reference scenes only
app/                   the website (Next.js, folders + Download/Delete)
lib/supabase.js        reads/deletes from Supabase storage (server only)
lib/folders.js         groups saved session parts into folders
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
Read AGENTS.md and skill/inkbeat-shorts/START_HERE.md first and follow them for every video task.
Then run the one-time setup from AGENTS.md (npm install and npm i -D playwright-core at the repo root, then python3 pipeline/doctor.py from skill/inkbeat-shorts).
Show me the doctor output. Then, from skill/inkbeat-shorts, render a 3-second test: python3 pipeline/make_video.py --scene beats_test --seconds 3 --mode draft --out /tmp/inkbeat-renders/test --no-qa
and tell me whether /tmp/inkbeat-renders/test/video.mp4 exists and the seconds per frame. Then render the same 3 seconds with --aspect 16:9 into /tmp/inkbeat-renders/test169 and tell me the same.
```

Also paste this line into AI Studio's system instructions so it never forgets:

```
Read AGENTS.md and skill/inkbeat-shorts/START_HERE.md before any video task.
```

## Things to ask the agent

- Send the transcript and photos: "Make a 9:16 Short from this transcript and these photos." It renders a draft in `/tmp` and tells you how it looks. Nothing is saved yet.
- "Same video for YouTube, 16:9." (small sentence captions, calm cuts)
- "Render it final." (higher quality, slower)
- "Save it." (uploads all parts to the `videos` bucket and the scene code to `scenes`, then replies with Watch links)
- "Render the tree_road scene as a 15 second draft."
- "What's on the shelf?"
- Or tap **Delete** right on any clip or folder in the website UI.

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
