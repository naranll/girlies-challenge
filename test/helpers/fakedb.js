'use strict';
// Tiny in-memory stand-in for the parts of the MongoDB driver that app.js uses.
// It mimics the real thing on the points that matter: unique indexes, upsert
// semantics, and the "$set and $setOnInsert on the same path" conflict error.

const clone = o => structuredClone(o);
const cmp = (val, cond) => {
  if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
    return Object.entries(cond).every(([op, v]) =>
      op === '$lte' ? val <= v : op === '$lt' ? val < v : op === '$gte' ? val >= v : op === '$gt' ? val > v : false);
  }
  return val === cond;
};
const match = (doc, f) => Object.entries(f).every(([k, v]) => cmp(doc[k], v));
const dup = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });

class Cursor {
  constructor(docs) { this.docs = docs; }
  sort(spec) {
    const [k, dir] = Object.entries(spec)[0];
    this.docs.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir);
    return this;
  }
  limit(n) { this.docs = this.docs.slice(0, n); return this; }
  async toArray() { return this.docs.map(clone); }
}

let autoId = 0;

class Collection {
  constructor() { this.docs = []; this.unique = []; }
  async createIndex(spec, opts) { if (opts && opts.unique) this.unique.push(Object.keys(spec)); }
  _check(doc, ignore) {
    if (this.docs.some(d => d !== ignore && d._id === doc._id)) throw dup();
    for (const keys of this.unique) {
      if (this.docs.some(d => d !== ignore && keys.every(k => d[k] === doc[k]))) throw dup();
    }
  }
  find(f = {}) { return new Cursor(this.docs.filter(d => match(d, f)).map(clone)); }
  async findOne(f) { const d = this.docs.find(x => match(x, f)); return d ? clone(d) : null; }
  async countDocuments(f = {}) { return this.docs.filter(d => match(d, f)).length; }
  async insertOne(doc) {
    const d = clone(doc);
    if (d._id === undefined) d._id = 'auto' + (++autoId);
    this._check(d);
    this.docs.push(d);
    return { insertedId: d._id };
  }
  async insertMany(arr) {
    let firstErr = null;
    for (const x of arr) {
      try { await this.insertOne(x); } catch (e) { firstErr = firstErr || e; }
    }
    if (firstErr) throw firstErr;
  }
  async updateOne(filter, update, opts = {}) {
    const set = update.$set || {}, soi = update.$setOnInsert || {}, unset = update.$unset || {}, inc = update.$inc || {};
    for (const k of Object.keys(set)) {
      if (k in soi) throw new Error(`Updating the path '${k}' would create a conflict at '${k}'`);
    }
    let doc = this.docs.find(d => match(d, filter));
    if (!doc) {
      if (!opts.upsert) return { matchedCount: 0, upsertedCount: 0 };
      doc = { ...filter, ...clone(soi), ...clone(set) };
      for (const [k, v] of Object.entries(inc)) doc[k] = (doc[k] || 0) + v;
      if (doc._id === undefined) doc._id = 'auto' + (++autoId);
      this._check(doc);
      this.docs.push(doc);
      return { matchedCount: 0, upsertedCount: 1 };
    }
    Object.assign(doc, clone(set));
    for (const k of Object.keys(unset)) delete doc[k];
    for (const [k, v] of Object.entries(inc)) doc[k] = (doc[k] || 0) + v;
    return { matchedCount: 1, upsertedCount: 0 };
  }
  async deleteMany(f) {
    const before = this.docs.length;
    this.docs = this.docs.filter(d => !match(d, f));
    return { deletedCount: before - this.docs.length };
  }
  async deleteOne(f) {
    const i = this.docs.findIndex(d => match(d, f));
    if (i >= 0) this.docs.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  }
}

class FakeDb {
  constructor() { this.cols = new Map(); }
  collection(name) {
    if (!this.cols.has(name)) this.cols.set(name, new Collection());
    return this.cols.get(name);
  }
}

module.exports = { FakeDb };
