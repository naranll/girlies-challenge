# Girlies' 30-Day Growth Challenge

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
- If someone already logged quests in the old browser-only version, a banner offers **Import it**. It copies their progress, proof links, dates, custom quests and looks to the shared tracker without overwriting anything already there. Do it once per device.

## Day to day

- **Change the passcode:** edit `APP_PASSCODE` in Render → Environment, then let it redeploy. Everyone is asked for the new one.
- **Quests** can be added and edited (from the faint ⋯ in a quest's popup) but not deleted.
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
