'use strict';

const { MongoClient } = require('mongodb');
const { createApp } = require('./app');

const uri = process.env.MONGODB_URI;
const passcode = process.env.APP_PASSCODE;
const port = Number(process.env.PORT) || 3000;

if (!uri || !passcode) {
  console.error('Missing settings. Set MONGODB_URI and APP_PASSCODE (see README.md).');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();

  // Use MONGODB_DB if given, else the name inside the connection string, else "glowup".
  let db = process.env.MONGODB_DB ? client.db(process.env.MONGODB_DB) : client.db();
  if (!process.env.MONGODB_DB && db.databaseName === 'test') db = client.db('glowup');
  console.log('Connected to MongoDB, database:', db.databaseName);

  const { app, init } = createApp({ db, passcode });
  await init();

  const server = app.listen(port, () => console.log('Listening on port', port));

  const stop = () => {
    server.close(() => client.close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch(err => {
  console.error('Could not start:', err.message);
  process.exit(1);
});
