#!/usr/bin/env node
// Regression checks for the client-to-host state relay. No browser or live app is needed.
import assert from 'node:assert/strict';
import '../lib/core.js';

const core = globalThis.__VRMPET3D_CORE__;
const posts = [];
const reporter = core.createStateReporter({
  fetchImpl: async (_url, options) => {
    posts.push(JSON.parse(options.body));
    return { ok: true };
  },
});
const why = id => ({ completedSessionId: id, completedSessionIds: id ? [id] : [], waitingSessionIds: ['waiting'] });

await reporter.report('waiting', null, null, null, false, 1, why('A'));
assert.equal(posts.at(-1).unread, 1);
await reporter.report('waiting', null, null, null, false, 0, why(null));
assert.equal(posts.at(-1).unread, 0, 'zero must be sent explicitly to clear the host count');
assert.deepEqual(posts.at(-1).why.completedSessionIds, []);
await reporter.beat();
assert.equal(posts.at(-1).unread, 0, 'a heartbeat must continue to send zero');

await reporter.report('waiting', null, null, null, false, 1, why('A'));
const before = posts.length;
await reporter.report('waiting', null, null, null, false, 1, why('B'));
assert.equal(posts.length, before + 1, 'a queue change must publish even when its count stays the same');
assert.deepEqual(posts.at(-1).why.completedSessionIds, ['B']);
await reporter.report('waiting', null, null, null, false, 1, why('B'));
assert.equal(posts.length, before + 1, 'an unchanged queue still deduplicates');

await reporter.report('resting', null, null, null, false, undefined, null);
assert.equal(Object.hasOwn(posts.at(-1), 'unread'), false, 'an unspecified count remains distinct from zero');
console.log('state report: 8 checks passed');
