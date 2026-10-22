'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../app');
const { FakeDb } = require('./helpers/fakedb');

const PASS = 'secret-pass';

async function start(passcode = PASS) {
  const { app, init } = createApp({ db: new FakeDb(), passcode });
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
  return { server, call, base };
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
  assert.equal(s.json.challenges.length, 30);
  assert.equal(s.json.challenges[0].title, 'Sunrise Meditation');
  assert.deepEqual(s.json.completions, {});

  const same = await call('GET', '/api/state?rev=' + s.json.rev);
  assert.equal(same.json.changed, false);
});

test('progress: save, validate, undo, keep first date', async t => {
  const { server, call } = await start();
  t.after(() => server.close());

  const bad = await call('PUT', '/api/progress', { changes: [{ challengeId: 1, friendId: 'zed', done: true }] });
  assert.equal(bad.status, 400);
  const badUrl = await call('PUT', '/api/progress', { changes: [{ challengeId: 1, friendId: 'mia', done: true, url: 'javascript:alert(1)' }] });
  assert.equal(badUrl.status, 400);
  const noQuest = await call('PUT', '/api/progress', { changes: [{ challengeId: 999, friendId: 'mia', done: true }] });
  assert.equal(noQuest.status, 404);

  const rev0 = (await call('GET', '/api/state')).json.rev;
  const ok = await call('PUT', '/api/progress', {
    changes: [
      { challengeId: 2, friendId: 'mia', done: true, url: 'https://instagram.com/p/abc', note: 'felt great', date: '2026-10-20' },
      { challengeId: 2, friendId: 'ava', done: true, url: '', note: '', date: '2026-10-21' }
    ]
  });
  assert.equal(ok.status, 200);

  let st = (await call('GET', '/api/state')).json;
  assert.ok(st.rev > rev0);
  assert.equal(st.completions['2'].mia, true);
  assert.equal(st.completions['2'].ava, true);
  assert.equal(st.proofs['2'].mia.url, 'https://instagram.com/p/abc');
  assert.equal(st.dates['2'].mia, '2026-10-20');

  // editing the note later must not move the original completion date
  await call('PUT', '/api/progress', { changes: [{ challengeId: 2, friendId: 'mia', done: true, url: 'https://instagram.com/p/abc', note: 'updated', date: '2026-10-25' }] });
  st = (await call('GET', '/api/state')).json;
  assert.equal(st.proofs['2'].mia.note, 'updated');
  assert.equal(st.dates['2'].mia, '2026-10-20');

  // undo
  await call('PUT', '/api/progress', { changes: [{ challengeId: 2, friendId: 'mia', done: false }] });
  st = (await call('GET', '/api/state')).json;
  assert.equal(st.completions['2'].mia, undefined);
  assert.equal(st.completions['2'].ava, true);
});

test('quests: add, duplicate, edit, no delete', async t => {
  const { server, call } = await start();
  t.after(() => server.close());

  assert.equal((await call('POST', '/api/quests', { title: '   ', icon: 'star' })).status, 400);
  assert.equal((await call('POST', '/api/quests', { title: 'x'.repeat(41) })).status, 400);
  assert.equal((await call('POST', '/api/quests', { title: 'read 15 pages' })).status, 409);

  const add = await call('POST', '/api/quests', { title: 'Dance to a song', icon: 'music' });
  assert.equal(add.status, 201);
  assert.equal(add.json.id, 31);

  const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  const withImg = await call('POST', '/api/quests', { title: 'With photo', icon: 'star', img: photo });
  assert.equal(withImg.json.img, photo);
  assert.equal((await call('POST', '/api/quests', { title: 'Bad photo', img: 'http://evil/x.png' })).status, 400);

  const edit = await call('PUT', '/api/quests/31', { title: 'Dance to two songs', icon: 'music' });
  assert.equal(edit.status, 200);
  assert.equal(edit.json.title, 'Dance to two songs');
  assert.equal((await call('PUT', '/api/quests/32', { title: 'With photo', icon: 'star', img: null })).json.img, undefined);
  assert.equal((await call('PUT', '/api/quests/31', { title: 'Sunrise Meditation' })).status, 409);
  assert.equal((await call('PUT', '/api/quests/500', { title: 'Nope' })).status, 404);

  assert.equal((await call('DELETE', '/api/quests/31')).status, 404);
  const st = (await call('GET', '/api/state')).json;
  assert.equal(st.challenges.length, 32);
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

test('import: merges, remaps custom quests, never overwrites', async t => {
  const { server, call } = await start();
  t.after(() => server.close());

  await call('PUT', '/api/progress', { changes: [{ challengeId: 3, friendId: 'mia', done: true, url: '', note: 'server copy', date: '2026-10-22' }] });
  const local = {
    challenges: [{ id: 31, title: 'Local custom quest', icon: 'heart' }],
    completions: { '3': { mia: true, chloe: true }, '31': { lily: true } },
    proofs: { '3': { mia: { url: '', note: 'local copy' }, chloe: { url: 'https://tiktok.com/@x/video/1', note: 'hi' } } },
    dates: { '3': { mia: '2026-10-20', chloe: '2026-10-21' }, '31': { lily: '2026-10-21' } },
    customs: { ava: { name: 'Ava', vibe: 'Mine', emoji: '🍀', palette: 'mint' } }
  };
  const r = await call('POST', '/api/import', { state: local });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { progress: 2, quests: 1, characters: 1 });

  const st = (await call('GET', '/api/state')).json;
  assert.equal(st.proofs['3'].mia.note, 'server copy'); // not overwritten
  assert.equal(st.completions['3'].chloe, true);
  assert.equal(st.dates['3'].chloe, '2026-10-21');
  assert.equal(st.challenges.find(q => q.title === 'Local custom quest').id, 31);
  assert.equal(st.completions['31'].lily, true);

  // running it again adds nothing
  const again = await call('POST', '/api/import', { state: local });
  assert.deepEqual(again.json, { progress: 0, quests: 0, characters: 0 });
});

test('too many wrong passcodes get blocked', async t => {
  const { server, call } = await start();
  t.after(() => server.close());
  let last;
  for (let i = 0; i < 11; i++) last = await call('GET', '/api/state', undefined, 'wrong-' + i);
  assert.equal(last.status, 429);
  // even the right passcode waits out the lockout
  assert.equal((await call('GET', '/api/state')).status, 429);
});
