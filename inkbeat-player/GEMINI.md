# Instructions for the AI editing this project

This repository is a Next.js app that plays ONE hardcoded 3D toon-style video with a single play button. The user's chat
message is a transcript; your job is to turn that transcript into the video by editing only `src/video/`.

1. Read `START_HERE.md` in full before writing anything. It is the spec and the skill. Also read `references/*.md` if you can.
2. Write `src/video/transcript.ts` (the user's text verbatim), `src/video/plan.ts`, `src/video/Scene.tsx`, and optional extra
   files under `src/video/`. Nothing else changes.
3. Never delete, rename or edit `START_HERE.md`, `references/`, `src/inkbeat/`, `src/player/`, `src/examples/`, `src/app/`,
   `public/`, `package.json`, `next.config.mjs`, `tsconfig.json`, or any other existing file outside `src/video/`.
4. No database, no backend, no external services, no extra UI. The only control on screen is the play button.
5. Do not ask questions or propose a plan first. Build it, then reply in 2-3 sentences.
