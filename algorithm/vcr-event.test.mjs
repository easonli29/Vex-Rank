import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_WEIGHTS, settleEvent, matchEvidence, expectedResult } from './vcr-event.mjs';
const fixture = (overrides = {}) => ({ rating: 1400, tier: 'Gold S', completed: true,
  matches: Array.from({length: 8}, () => matchEvidence({actual: 0, expected: .8, margin: 40, scoreScale: 25})),
  qualificationActual: .1, qualificationExpected: .7, eliminationActual: 1,
  eliminationExpected: .4, titleProbability: .1, champion: true,
  contributionResidual: -5, autoResidual: -5, ...overrides });
test('unexpected champion gains at every tier despite worst-case other components', () => {
  for (const tier of Object.keys(EVENT_WEIGHTS)) {
    const r = settleEvent(fixture({tier}));
    assert.ok(r.delta > 0); assert.ok(Math.abs(r.delta-r.championFloor)<1e-10);
    assert.ok(Math.abs(r.ratingAfter-r.ratingBefore-r.delta)<1e-10);
  }
});
test('stronger event increases unexpected champion minimum', () => {
  const deltas = Object.keys(EVENT_WEIGHTS).map(tier => settleEvent(fixture({tier})).delta);
  assert.ok(deltas.every((d,i) => !i || d > deltas[i-1]));
});
test('favorite champion cannot lose; non-champion retains legitimate losses', () => {
  assert.equal(settleEvent(fixture({titleProbability: .9})).delta, 0);
  assert.ok(settleEvent(fixture({champion:false, eliminationActual: .1})).delta < 0);
});
test('low-tier underperformance has larger penalty than elite-tier equivalent', () => {
  const o={champion:false,eliminationActual:0};
  assert.ok(settleEvent(fixture({...o,tier:'C'})).delta < settleEvent(fixture({...o,tier:'Gold S'})).delta);
});
test('margin uses magnitude so equivalent winner/loser evidence is symmetric', () => {
  const common={expected:.5,scoreScale:25};
  assert.equal(matchEvidence({...common,actual:1,margin:30}).residual, -matchEvidence({...common,actual:0,margin:-30}).residual);
  assert.equal(expectedResult(1400,1600)+expectedResult(1600,1400),1);
});
test('duplicate longer schedule does not farm match component after saturation', () => {
  const rows=Array.from({length:6},()=>matchEvidence({actual:1,expected:.5,margin:20,scoreScale:25}));
  assert.ok(Math.abs(settleEvent(fixture({matches:rows})).components.match-settleEvent(fixture({matches:[...rows,...rows]})).components.match)<1e-10);
});
test('missing statistics neutral; zero reliability produces zero settlement', () => {
  const r=settleEvent(fixture({contributionResidual:null,autoResidual:null,reliability:0}));
  assert.equal(r.components.contribution,0); assert.equal(r.components.auto,0); assert.equal(r.delta,0);
});
test('reject incomplete event, inconsistent champion, invalid or nonfinite evidence', () => {
  for(const o of [{completed:false},{eliminationActual:.9},{tier:'unknown'},{titleProbability:NaN},{reliability:-1},{rating:Infinity}]) assert.throws(()=>settleEvent(fixture(o)));
});
test('audit sums and monotonic advancement across parameter grid', () => {
  for(const tier of Object.keys(EVENT_WEIGHTS)) for(const q of [0,.5,1]) {
    let previous=-Infinity;
    for(const e of [0,.25,.5,.75,1]) {
      const r=settleEvent(fixture({tier,qualificationActual:q,eliminationActual:e,champion:false}));
      assert.ok(r.delta>=previous); previous=r.delta;
      assert.ok(Math.abs(r.delta-(r.weighted+r.achievementCorrection+r.capAdjustment))<1e-10);
      assert.ok(Math.abs(r.delta)<=100);
    }
  }
});
