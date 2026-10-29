# Girlies' 30-Day Creative Challenge

A shared tracker for four friends. Express serves the page and a small API; MongoDB Atlas stores everything.
Everyone opens the same link, enters the group passcode once, and sees the same progress (it refreshes every ~8 seconds).


## Run locally

```
npm install
cp .env.example .env     # then fill in the real values
npm run dev              # http://localhost:3000
npm test                 # API tests (no database needed)
```

