import test from 'node:test';
import assert from 'node:assert/strict';
import { routeToHash, hashToRoute } from '../lib/routes.mjs';

test('top-level views round-trip through the hash', () => {
  for (const view of ['home', 'events', 'rankings', 'stats', 'teams']) {
    assert.deepEqual(hashToRoute(routeToHash(view, null, null)), { view });
  }
});

test('detail views carry their identifier both ways', () => {
  assert.equal(routeToHash('team', { number: '31260X' }, null), '#/teams/31260X');
  assert.deepEqual(hashToRoute('#/teams/31260X'), { view: 'team', teamNumber: '31260X' });
  assert.equal(routeToHash('event', null, { id: 64604 }), '#/events/64604');
  assert.deepEqual(hashToRoute('#/events/64604'), { view: 'event', eventId: '64604' });
});

test('a detail view without its identifier falls back to the list', () => {
  assert.equal(routeToHash('team', {}, null), '#/teams');
  assert.equal(routeToHash('event', null, undefined), '#/events');
});

test('team numbers needing encoding survive the round trip', () => {
  const number = '2775V/B';
  const hash = routeToHash('team', { number }, null);
  assert.ok(!hash.endsWith('/B'), 'slash must be encoded, not left as a path separator');
  assert.deepEqual(hashToRoute(hash), { view: 'team', teamNumber: number });
});

test('empty and unrecognised hashes are handled distinctly', () => {
  assert.deepEqual(hashToRoute(''), { view: 'home' });
  assert.deepEqual(hashToRoute('#/'), { view: 'home' });
  assert.equal(hashToRoute('#/nope'), null, 'unknown route is ignored, not guessed');
  assert.equal(hashToRoute('#/teams/%E0%A4%A'), null, 'malformed encoding must not throw');
});
