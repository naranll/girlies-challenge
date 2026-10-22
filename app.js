'use strict';

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const DEFAULT_QUESTS = require('./default-quests.json');

const FRIEND_IDS = ['mia', 'chloe', 'lily', 'ava'];
const PALETTES = ['rose', 'lavender', 'sunshine', 'mint', 'sky', 'peach', 'coral', 'teal'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ICON_RE = /^[a-z]{2,20}$/;
const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMG_CHARS = 200 * 1024;

// Bump when the built-in quest list changes; init() re-seeds once per version.
const SEED_VERSION = 2;
const PLACEHOLDER_MAX_ID = 30; // ids 1..30 were the original placeholder quests

const FAIL_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 10;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const asyncH = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const sha = s => crypto.createHash('sha256').update(String(s)).digest();

// ---------- input cleaning (never trust the browser) ----------
function cleanTitle(v) {
  const t = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (!t) throw new HttpError(400, 'Give your quest a name first.');
  if (t.length > 40) throw new HttpError(400, 'Keep the name to 40 characters or fewer.');
  return t;
}

function cleanIcon(v) {
  return typeof v === 'string' && ICON_RE.test(v) ? v : 'star';
}

function cleanImg(v) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || v.length > MAX_IMG_CHARS || !IMG_RE.test(v)) {
    throw new HttpError(400, 'That photo is not usable. Try a smaller one.');
  }
  return v;
}

function cleanUrl(v) {
  if (v == null || v === '') return '';
  if (typeof v !== 'string' || v.length > 500) throw new HttpError(400, 'Proof links must be under 500 characters.');
  let u;
  try { u = new URL(v); } catch (e) { throw new HttpError(400, 'Proof links must start with http:// or https://'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new HttpError(400, 'Proof links must start with http:// or https://');
  }
  return u.href;
}

function cleanNote(v) {
  return typeof v === 'string' ? v.trim().slice(0, 140) : '';
}

function cleanInfo(v) {
  const t = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (t.length > 140) throw new HttpError(400, 'Keep the short info to 140 characters or fewer.');
  return t;
}

function cleanCharacter(c) {
  if (!isObj(c)) throw new HttpError(400, 'Invalid character.');
  const name = typeof c.name === 'string' ? c.name.trim() : '';
  const vibe = typeof c.vibe === 'string' ? c.vibe.trim() : '';
  const emoji = typeof c.emoji === 'string' ? c.emoji.trim() : '';
  if (!name || name.length > 14) throw new HttpError(400, 'Name must be 1–14 characters.');
  if (!vibe || vibe.length > 28) throw new HttpError(400, 'Vibe must be 1–28 characters.');
  if (!emoji || emoji.length > 16) throw new HttpError(400, 'Pick a single emoji.');
  if (!PALETTES.includes(c.palette)) throw new HttpError(400, 'Unknown colour.');
  return { name, vibe, emoji, palette: c.palette };
}

// ---------- app ----------
function createApp({ db, passcode }) {
  if (!db) throw new Error('createApp needs a db');
  if (!passcode) throw new Error('createApp needs a passcode');

  const col = {
    quests: db.collection('quests'),
    progress: db.collection('progress'),
    characters: db.collection('characters'),
    meta: db.collection('meta')
  };

  const passHash = sha(passcode);
  const passOk = given => typeof given === 'string' && crypto.timingSafeEqual(sha(given), passHash);

  // wrong-passcode limiter (per IP, in memory)
  const fails = new Map();
  function limited(ip) {
    const e = fails.get(ip);
    if (!e) return false;
    if (Date.now() > e.reset) { fails.delete(ip); return false; }
    return e.n >= MAX_FAILS;
  }
  function noteFail(ip) {
    if (fails.size > 1000) {
      for (const [k, v] of fails) if (Date.now() > v.reset) fails.delete(k);
    }
    const e = fails.get(ip);
    if (!e || Date.now() > e.reset) fails.set(ip, { n: 1, reset: Date.now() + FAIL_WINDOW_MS });
    else e.n++;
  }

  // revision counter: bumps on every write so clients can cheaply ask "anything new?"
  const bumpRev = () => col.meta.updateOne({ _id: 'rev' }, { $inc: { n: 1 } }, { upsert: true });
  async function getRev() {
    const d = await col.meta.findOne({ _id: 'rev' });
    return d ? d.n : 0;
  }

  async function init() {
    await col.progress.createIndex({ challengeId: 1, friendId: 1 }, { unique: true });
    const seed = await col.meta.findOne({ _id: 'seed' });
    if (seed && seed.v >= SEED_VERSION) return;

    // One-time switch to the real quest list: the original placeholder quests (ids 1-30)
    // and any progress logged on them are removed. Quests added later (ids 31+) are kept.
    await col.progress.deleteMany({ challengeId: { $lte: PLACEHOLDER_MAX_ID } });
    await col.quests.deleteMany({ _id: { $lte: PLACEHOLDER_MAX_ID } });
    try {
      await col.quests.insertMany(
        DEFAULT_QUESTS.map(q => ({ _id: q.id, title: q.title, icon: q.icon, info: q.info || '' })),
        { ordered: false }
      );
    } catch (e) {
      if (!/E11000/.test(String(e && e.message))) throw e;
    }
    await col.meta.updateOne({ _id: 'seed' }, { $set: { v: SEED_VERSION } }, { upsert: true });
    await bumpRev();
  }

  async function nextQuestId() {
    const last = await col.quests.find({}).sort({ _id: -1 }).limit(1).toArray();
    return last.length ? last[0]._id + 1 : 1;
  }

  async function insertQuest({ title, icon, img, info }) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = await nextQuestId();
      const doc = { _id: id, title, icon, info: info || '' };
      if (img) doc.img = img;
      try {
        await col.quests.insertOne(doc);
        return id;
      } catch (e) {
        if (!/E11000/.test(String(e && e.message))) throw e; // someone else took the id, retry
      }
    }
    throw new HttpError(409, 'Could not add the quest, please try again.');
  }

  async function assertUniqueTitle(title, exceptId) {
    const all = await col.quests.find({}).toArray();
    const low = title.toLowerCase();
    if (all.some(q => q._id !== exceptId && q.title.toLowerCase() === low)) {
      throw new HttpError(409, 'A quest with that name already exists.');
    }
  }

  const questOut = q => {
    const o = { id: q._id, title: q.title, icon: q.icon, info: q.info || '' };
    if (q.img) o.img = q.img;
    return o;
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'SAMEORIGIN'
    });
    next();
  });

  const small = express.json({ limit: '400kb' });
  const big = express.json({ limit: '4mb' });

  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  // ----- auth -----
  function checkPass(req, given) {
    if (limited(req.ip)) throw new HttpError(429, 'Too many wrong tries. Wait a few minutes and try again.');
    if (passOk(given)) return;
    if (given !== undefined) noteFail(req.ip);
    throw new HttpError(401, 'Wrong passcode.');
  }

  app.post('/api/login', small, (req, res, next) => {
    try {
      checkPass(req, req.body && req.body.passcode);
      res.set('Cache-Control', 'no-store').json({ ok: true });
    } catch (e) { next(e); }
  });

  const api = express.Router();
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { checkPass(req, req.get('x-passcode')); next(); } catch (e) { next(e); }
  });

  // ----- read -----
  api.get('/state', asyncH(async (req, res) => {
    const rev = await getRev(); // read BEFORE the data: a newer write only makes the client refetch once more
    if (req.query.rev !== undefined && Number(req.query.rev) === rev) {
      return res.json({ changed: false, rev });
    }
    const [quests, progress, chars] = await Promise.all([
      col.quests.find({}).sort({ _id: 1 }).toArray(),
      col.progress.find({}).toArray(),
      col.characters.find({}).toArray()
    ]);
    const completions = {}, proofs = {}, dates = {}, customs = {};
    for (const p of progress) {
      const c = String(p.challengeId);
      (completions[c] = completions[c] || {})[p.friendId] = true;
      (proofs[c] = proofs[c] || {})[p.friendId] = { url: p.url || '', note: p.note || '' };
      if (p.date) (dates[c] = dates[c] || {})[p.friendId] = p.date;
    }
    for (const ch of chars) {
      customs[ch._id] = { name: ch.name, vibe: ch.vibe, emoji: ch.emoji, palette: ch.palette };
    }
    res.json({ changed: true, rev, challenges: quests.map(questOut), completions, proofs, dates, customs });
  }));

  // ----- progress: batch of per-person changes -----
  api.put('/progress', small, asyncH(async (req, res) => {
    const changes = req.body && req.body.changes;
    if (!Array.isArray(changes) || !changes.length || changes.length > 8) {
      throw new HttpError(400, 'Nothing to save.');
    }
    const prepared = [];
    for (const c of changes) {
      if (!isObj(c)) throw new HttpError(400, 'Invalid change.');
      if (!Number.isInteger(c.challengeId)) throw new HttpError(400, 'Unknown quest.');
      if (!FRIEND_IDS.includes(c.friendId)) throw new HttpError(400, 'Unknown person.');
      if (!(await col.quests.findOne({ _id: c.challengeId }))) throw new HttpError(404, 'Quest not found.');
      if (c.done === true) {
        const url = cleanUrl(c.url);
        if (!url) throw new HttpError(400, 'Add your proof link to mark this quest as done.');
        prepared.push({
          challengeId: c.challengeId,
          friendId: c.friendId,
          done: true,
          url,
          note: cleanNote(c.note),
          date: DATE_RE.test(c.date) ? c.date : new Date().toISOString().slice(0, 10)
        });
      } else {
        prepared.push({ challengeId: c.challengeId, friendId: c.friendId, done: false });
      }
    }
    for (const p of prepared) {
      const filter = { challengeId: p.challengeId, friendId: p.friendId };
      if (p.done) {
        await col.progress.updateOne(
          filter,
          { $set: { url: p.url, note: p.note, updatedAt: new Date() }, $setOnInsert: { date: p.date } },
          { upsert: true }
        );
      } else {
        await col.progress.deleteOne(filter);
      }
    }
    await bumpRev();
    res.json({ ok: true, rev: await getRev() });
  }));

  // ----- quests: add + edit only (no delete on purpose) -----
  api.post('/quests', small, asyncH(async (req, res) => {
    const b = req.body || {};
    const title = cleanTitle(b.title);
    const img = cleanImg(b.img);
    await assertUniqueTitle(title, null);
    const id = await insertQuest({ title, icon: cleanIcon(b.icon), img, info: cleanInfo(b.info) });
    await bumpRev();
    res.status(201).json(questOut(await col.quests.findOne({ _id: id })));
  }));

  api.put('/quests/:id', small, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !(await col.quests.findOne({ _id: id }))) {
      throw new HttpError(404, 'Quest not found.');
    }
    const b = req.body || {};
    const title = cleanTitle(b.title);
    const img = cleanImg(b.img);
    await assertUniqueTitle(title, id);
    const set = { title, icon: cleanIcon(b.icon), info: cleanInfo(b.info) };
    const update = { $set: set };
    if (img) set.img = img; else update.$unset = { img: '' };
    await col.quests.updateOne({ _id: id }, update);
    await bumpRev();
    res.json(questOut(await col.quests.findOne({ _id: id })));
  }));

  // ----- character look -----
  api.put('/characters/:fid', small, asyncH(async (req, res) => {
    const fid = req.params.fid;
    if (!FRIEND_IDS.includes(fid)) throw new HttpError(404, 'Unknown person.');
    const clean = cleanCharacter(req.body);
    await col.characters.updateOne({ _id: fid }, { $set: clean }, { upsert: true });
    await bumpRev();
    res.json({ ok: true });
  }));

  api.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use('/api', api);

  app.use(express.static(path.join(__dirname, 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    let message = err.message;
    if (status === 413) message = 'That is too big. Try a smaller photo.';
    if (status === 400 && err.type === 'entity.parse.failed') message = 'Bad request.';
    if (status === 500) {
      console.error(err);
      message = 'Something went wrong on the server.';
    }
    res.status(status).json({ error: message });
  });

  return { app, init };
}

module.exports = { createApp, FRIEND_IDS, PALETTES };
