'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');
const { FakeDb } = require('./helpers/fakedb');

const PASS = 'secret-pass';
const LINK = 'https://instagram.com/p/abc';

async function start(passcode = PASS, db = new FakeDb()) {
  const { app, init } = createApp({ db, passcode });
  await init();
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, pass = passcode) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(pass ? { 'x-passcode': pass } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* not json */ }
    return { status: res.status, json };
  };
  return { server, call, base, db };
}

test('auth, seeding and state', async t => {
  const { server, call, base } = await start();
  t.after(() => server.close());

  assert.equal((await fetch(base + '/healthz')).status, 200);
  assert.equal((await call('GET', '/api/state', undefined, null)).status, 401);
  assert.equal((await call('GET', '/api/state', undefined, 'nope')).status, 401);
  assert.equal((await call('POST', '/api/login', { passcode: 'nope' }, null)).status, 401);
  assert.equal((await call('POST', '/api/login', { passcode: PASS }, null)).status, 200);

  const s = await call('GET', '/api/state');
  assert.equal(s.status, 200);
  assert.equal(s.json.challenges.length, 19);
  assert.equal(s.json.challenges[0].title, 'Read 50 Pages of a Book');
  assert.ok(s.json.challenges.every(q => q.title && q.icon && q.info), 'every quest has title, picture and short info');
  assert.deepEqual(s.json.completions, {});

  const same = await call('GET', '/api/state?rev=' + s.json.rev);
  assert.equal(same.json.changed, false);
});

test('progress: proof link is required, validated, date kept, undo works', async t => {
  const { server, call } = await start();
  t.after(() => server.close());

  const done = (extra = {}) => ({ challengeId: 2, friendId: 'mia', done: true, ...extra });
  assert.equal((await call('PUT', '/api/progress', { changes: [{ challengeId: 1, friendId: 'zed', done: true, url: LINK }] })).status, 400);
  assert.equal((await call('PUT', '/api/progress', { changes: [done({ url: 'javascript:alert(1)' })] })).status, 400);
  const noLink = await call('PUT', '/api/progress', { changes: [done({ url: '' })] });
  assert.equal(noLink.status, 400);
  assert.match(noLink.json.error, /proof link/i);
  assert.equal((await call('PUT', '/api/progress', { changes: [done()] })).status, 400);
  assert.equal((await call('PUT', '/api/progress', { changes: [{ challengeId: 999, friendId: 'mia', done: true, url: LINK }] })).status, 404);

  const rev0 = (await call('GET', '/api/state')).json.rev;
  const ok = await call('PUT', '/api/progress', {
    changes: [
      done({ url: LINK, note: 'felt great', date: '2026-10-21' }),
      { challengeId: 2, friendId: 'ava', done: true, url: 'https://tiktok.com/@a/video/1', note: '', date: '2026-10-22' }
    ]
  });
  assert.equal(ok.status, 200);

  let st = (await call('GET', '/api/state')).json;
  assert.ok(st.rev > rev0);
  assert.equal(st.completions['2'].mia, true);
  assert.equal(st.completions['2'].ava, true);
  assert.equal(st.proofs['2'].mia.url, LINK);
  assert.equal(st.dates['2'].mia, '2026-10-21');

  // editing the note later must not move the original completion date
  await call('PUT', '/api/progress', { changes: [done({ url: LINK, note: 'updated', date: '2026-10-25' })] });
  st = (await call('GET', '/api/state')).json;
  assert.equal(st.proofs['2'].mia.note, 'updated');
  assert.equal(st.dates['2'].mia, '2026-10-21');

  // undo needs no link
  await call('PUT', '/api/progress', { changes: [{ challengeId: 2, friendId: 'mia', done: false }] });
  st = (await call('GET', '/api/state')).json;
  assert.equal(st.completions['2'].mia, undefined);
  assert.equal(st.completions['2'].ava, true);
});

test('quests: add, short info, duplicate, edit, no delete', async t => {
  const { server, call } = await start();
  t.after(() => server.close());

  assert.equal((await call('POST', '/api/quests', { title: '   ', icon: 'star' })).status, 400);
  assert.equal((await call('POST', '/api/quests', { title: 'x'.repeat(41) })).status, 400);
  assert.equal((await call('POST', '/api/quests', { title: 'read 50 pages of a book' })).status, 409);
  assert.equal((await call('POST', '/api/quests', { title: 'Too wordy', info: 'y'.repeat(141) })).status, 400);

  const add = await call('POST', '/api/quests', { title: 'Dance to a song', icon: 'music', info: '  Move   your body.  ' });
  assert.equal(add.status, 201);
  assert.equal(add.json.id, 20);
  assert.equal(add.json.info, 'Move your body.');

  const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const withImg = await call('POST', '/api/quests', { title: 'With photo', icon: 'star', img: photo });
  assert.equal(withImg.json.img, photo);
  assert.equal(withImg.json.info, '');
  assert.equal((await call('POST', '/api/quests', { title: 'Bad photo', img: 'http://evil/x.png' })).status, 400);

  const edit = await call('PUT', '/api/quests/20', { title: 'Dance to two songs', icon: 'music', info: 'Twice the fun.' });
  assert.equal(edit.status, 200);
  assert.equal(edit.json.title, 'Dance to two songs');
  assert.equal(edit.json.info, 'Twice the fun.');
  assert.equal((await call('PUT', '/api/quests/21', { title: 'With photo', icon: 'star', img: null })).json.img, undefined);
  assert.equal((await call('PUT', '/api/quests/20', { title: 'Read 50 Pages of a Book' })).status, 409);
  assert.equal((await call('PUT', '/api/quests/500', { title: 'Nope' })).status, 404);

  assert.equal((await call('DELETE', '/api/quests/20')).status, 404);
  assert.equal((await call('GET', '/api/state')).json.challenges.length, 21);
});

test('characters', async t => {
  const { server, call } = await start();
  t.after(() => server.close());

  const ok = await call('PUT', '/api/characters/ava', { name: 'Ava', vibe: 'Fresh Start Energy', emoji: '🦄', palette: 'coral' });
  assert.equal(ok.status, 200);
  assert.deepEqual((await call('GET', '/api/state')).json.customs.ava, { name: 'Ava', vibe: 'Fresh Start Energy', emoji: '🦄', palette: 'coral' });
  assert.equal((await call('PUT', '/api/characters/ava', { name: 'Ava', vibe: 'x', emoji: '🦄', palette: 'neon' })).status, 400);
  assert.equal((await call('PUT', '/api/characters/bob', { name: 'Bob', vibe: 'x', emoji: '🦄', palette: 'rose' })).status, 404);
});

test('upgrade from the placeholder list: replaces ids 1-30 once, keeps later quests', async t => {
  // Build a database the way the first deployment left it: 30 placeholder quests, no seed marker.
  const db = new FakeDb();
  const quests = db.collection('quests');
  for (let i = 1; i <= 30; i++) await quests.insertOne({ _id: i, title: 'Placeholder ' + i, icon: 'star' });
  await quests.insertOne({ _id: 31, title: 'My own quest', icon: 'heart', info: 'kept' });
  const progress = db.collection('progress');
  await progress.insertOne({ challengeId: 2, friendId: 'mia', url: LINK, note: '', date: '2026-10-21' });   // on a placeholder
  await progress.insertOne({ challengeId: 31, friendId: 'ava', url: LINK, note: '', date: '2026-10-21' });  // on a kept quest

  const { server, call } = await start(PASS, db);
  t.after(() => server.close());

  let st = (await call('GET', '/api/state')).json;
  assert.equal(st.challenges.length, 20);
  assert.equal(st.challenges[0].title, 'Read 50 Pages of a Book');
  assert.equal(st.challenges[19].title, 'My own quest');
  assert.equal(st.completions['2'], undefined, 'progress on a placeholder is cleared');
  assert.equal(st.completions['31'].ava, true, 'progress on a kept quest survives');

  // a second start must not touch anything again
  await call('PUT', '/api/progress', { changes: [{ challengeId: 2, friendId: 'chloe', done: true, url: LINK, date: '2026-10-22' }] });
  const again = await start(PASS, db);
  t.after(() => again.server.close());
  st = (await again.call('GET', '/api/state')).json;
  assert.equal(st.completions['2'].chloe, true);
  assert.equal(st.challenges.length, 20);
});

test('too many wrong passcodes get blocked', async t => {
  const { server, call } = await start();
  t.after(() => server.close());
  let last;
  for (let i = 0; i < 11; i++) last = await call('GET', '/api/state', undefined, 'wrong-' + i);
  assert.equal(last.status, 429);
  assert.equal((await call('GET', '/api/state')).status, 429);
});
