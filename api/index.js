'use strict';

// Vercel entry point: the same Express app as server.js, but exported as a function
// instead of calling app.listen. The MongoDB connection is cached between requests
// so only a cold start pays for connecting.

const { MongoClient } = require('mongodb');
const { createApp } = require('../app');

let ready; // promise of the Express app, shared by every request this instance handles

function boot() {
  const uri = process.env.MONGODB_URI;
  const passcode = process.env.APP_PASSCODE;
  if (!uri || !passcode) throw new Error('Missing settings. Set MONGODB_URI and APP_PASSCODE.');

  return (async () => {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 5 });
    await client.connect();

    let db = process.env.MONGODB_DB ? client.db(process.env.MONGODB_DB) : client.db();
    if (!process.env.MONGODB_DB && db.databaseName === 'test') db = client.db('glowup');

    const { app, init } = createApp({ db, passcode });
    await init();
    return app;
  })();
}

module.exports = async (req, res) => {
  try {
    if (!ready) ready = boot();
    const app = await ready;
    return app(req, res);
  } catch (err) {
    ready = undefined; // let the next request try again
    console.error('Could not start:', err.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Something went wrong on the server.' }));
  }
};
