# Girlies' 30-Day Creative Challenge

A shared tracker for four friends. Express serves the page and a small API; MongoDB Atlas stores everything.
Everyone opens the same link, enters the group passcode once, and sees the same progress (it refreshes every ~8 seconds).

## Deploy on Vercel (free, no sleeping)

The repo is already set up for it: `api/index.js` runs the Express app as a serverless function, `vercel.json` sends `/api/*` and `/healthz` to it, and `public/` is served from Vercel's CDN.

1. Push the repo to GitHub.
2. On vercel.com: **Add New → Project**, import the repo. Leave Framework as **Other** and the build settings empty.
3. **Environment Variables:** add `MONGODB_URI` and `APP_PASSCODE` (optionally `MONGODB_DB`).
4. **Deploy.** Atlas must allow `0.0.0.0/0` in Network Access, because Vercel has no fixed IP.

Or from the terminal: `npm i -g vercel`, then `vercel`, then `vercel --prod`.

Tip: in Vercel → Settings → Functions, set the region closest to your Atlas cluster. Vercel's Hobby plan is for non-commercial use.

## Run locally

```
npm install
cp .env.example .env     # then fill in the real values
npm run dev              # http://localhost:3000
npm test                 # API tests (no database needed)
```
