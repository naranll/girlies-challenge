# Girlies' 30-Day Creative Challenge

A shared tracker for four friends. Express serves the page and a small API; MongoDB Atlas stores everything.
Everyone opens the same link, enters the group passcode once, and sees the same progress (it refreshes every ~8 seconds).

## What you need

- A MongoDB Atlas cluster (free M0) with a database user and `0.0.0.0/0` allowed in Network Access
- Your Atlas connection string, with the password filled in and `glowup` after `.mongodb.net/`:
  `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/glowup?retryWrites=true&w=majority`
- A group passcode (any phrase you all share)

## Deploy on Render (free)

1. **Put the code on GitHub.** Create a new *private* repo. On the repo page choose **Add file → Upload files**, drag in everything from this folder (`app.js`, `server.js`, `package.json`, `package-lock.json`, `default-quests.json`, `public/`, `test/`, `README.md`, `.gitignore`, `.env.example`), and commit. Do **not** upload a `.env` file or `node_modules`.
2. **Render:** New → **Web Service** → connect the repo.
3. Settings:
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free**
   - Advanced → Health Check Path: `/healthz`
4. **Environment variables** (Advanced → Add Environment Variable):
   - `MONGODB_URI` = your connection string
   - `APP_PASSCODE` = your group passcode
5. Click **Create Web Service**. When the log says `Connected to MongoDB` and `Listening on port`, open the `onrender.com` link. That link is your official site.

Free Render services go to sleep when idle, so the first visit after a quiet spell can take up to a minute (the page says "Waking the server up…"). Opening the link a few minutes before you post it avoids this.

## First visit

- Everyone enters the passcode once per device.
- Every quest has a number, a picture, a title and a short info line. Logging a quest needs a **proof link** (Instagram or TikTok); the reflection is optional.

## Upgrading from the first version (placeholder quests)

The first release came with 30 placeholder quests. The first time this version starts against that database it
**replaces quests #1–#30 with your 19 real ones and clears any progress that was logged on the placeholders**
(this happens once; a marker in the `meta` collection stops it repeating). Quests you added yourself with
**+ Add quest** (ids 31 and up) are kept. A brand-new database simply starts with the 19 quests.
The old "import from this browser" button is gone, because the old quest ids no longer match.

## Day to day

- **Change the passcode:** edit `APP_PASSCODE` in Render → Environment, then let it redeploy. Everyone is asked for the new one.
- **Quests** can be added and edited (from the faint ⋯ in a quest's popup) but not deleted. The built-in list lives in `default-quests.json` and is only used for brand-new databases.
- **See or export your data:** Atlas → Browse Collections → database `glowup` (`quests`, `progress`, `characters`).
- **Move to a different host:** any Node host works. Set the same two variables and run `npm start`.

## Run locally

```
npm install
cp .env.example .env     # then fill in the real values
npm run dev              # http://localhost:3000
npm test                 # API tests (no database needed)
```

## Notes

- The passcode is a shared secret, enough to keep strangers out of a friends-only page. Anyone who has it can edit anyone's entries.
- Wrong passcodes are rate-limited (10 tries per 10 minutes per IP).
- Keep the Atlas password to letters and numbers. Special characters must be URL-encoded inside the connection string.
