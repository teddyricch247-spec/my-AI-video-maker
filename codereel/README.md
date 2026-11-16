# Codereel (Next.js, UI only)

Front-end prototype: a home page and a 4-step order flow. No backend, no database, no real payments.
Everything the visitor types stays in the browser's memory and is never sent anywhere.

## Run locally
```bash
npm install
npm run dev      # http://localhost:3000
```

## Deploy on Vercel
1. Push this folder to a GitHub repo.
2. On vercel.com choose **Add New → Project**, import the repo, and press **Deploy**.
   Vercel detects Next.js on its own. No environment variables are needed.

## Where things are
| Path | What it is |
| --- | --- |
| `app/page.js` | Home page |
| `app/order/page.js` | Order page (style → details → payment → account) |
| `components/OrderFlow.js` | The whole order flow (React state + form validation) |
| `components/Showcase.js` | The looping "what we can make" reel in the middle of the home page |
| `components/HeroStage.js` | The hero "writing code" animation |
| `components/HomeSections.js` | Stats tiles, How it works, Pricing, FAQ, closing call-to-action |
| `app/globals.css` | All styles, including the drifting-cloud background |
| `public/clouds/` | Cloud textures used by the background |

## Replace the placeholder reel with your real video
Put your file in `public/` (for example `public/showreel.mp4`), then in `components/Showcase.js` set:
```js
const VIDEO_SRC = "/showreel.mp4";
```
The animated placeholder, its style tabs and the "Placeholder reel" badge are replaced by your video.

## When you add a real backend later
- `components/OrderFlow.js`: `pay()` and `create()` are where checkout and account creation would be called.
- Use a hosted checkout (e.g. Stripe Checkout) instead of collecting card numbers in your own form.
