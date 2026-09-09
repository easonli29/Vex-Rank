// VCR 3.0 candidate: pure event settlement, with caller-supplied frozen evidence.
export const EVENT_WEIGHTS = Object.freeze({ C: .70, B: .82, A: .95, 'Bronze S': 1.15, 'Silver S': 1.35, 'Gold S': 1.60, Worlds: 1.85 });
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function number(x, name, lo = -Infinity, hi = Infinity) {
  if (!Number.isFinite(x) || x < lo || x > hi) throw new RangeError(`Invalid ${name}`);
  return x;
}
export function expectedResult(ownAllianceRating, opponentAllianceRating) {
  number(ownAllianceRating, 'own rating'); number(opponentAllianceRating, 'opponent rating');
  return 1 / (1 + 10 ** ((opponentAllianceRating - ownAllianceRating) / 400));
}
export function matchEvidence({ actual, expected, margin, scoreScale, share = .5, reliability = 1 }) {
  if (![0, .5, 1].includes(actual)) throw new RangeError('Invalid actual');
  number(expected, 'expected', 0, 1); number(margin, 'margin');
  number(scoreScale, 'scoreScale', Number.MIN_VALUE); number(share, 'share', .2, .8);
  number(reliability, 'reliability', 0, 1);
  const mov = actual === .5 ? 1 : 1 + .25 * Math.tanh(Math.abs(margin) / scoreScale);
  return { residual: (actual - expected) * mov * 2 * share, reliability };
}
function matchComponent(rows) {
  if (!Array.isArray(rows)) throw new TypeError('matches must be an array');
  let total = 0, mass = 0;
  for (const row of rows) {
    number(row.residual, 'residual', -2, 2); number(row.reliability, 'match reliability', 0, 1);
    total += row.residual * row.reliability; mass += row.reliability;
  }
  // Saturation prevents accumulating points merely through a longer schedule.
  return 40 * (mass ? total / mass : 0) * Math.min(1, mass / 6);
}
export function settleEvent(input) {
  const { rating, tier, matches, qualificationActual, qualificationExpected,
    eliminationActual, eliminationExpected, champion = false, titleProbability,
    completed, reliability = 1, contributionResidual = null, autoResidual = null } = input;
  number(rating, 'rating'); number(reliability, 'reliability', 0, 1);
  if (!Object.hasOwn(EVENT_WEIGHTS, tier)) throw new RangeError('Unknown tier');
  if (completed !== true) throw new Error('Only a verified completed event may settle');
  for (const [k, v] of Object.entries({ qualificationActual, qualificationExpected, eliminationActual, eliminationExpected, titleProbability })) number(v, k, 0, 1);
  if (champion && eliminationActual !== 1) throw new Error('Champion must have eliminationActual=1');
  const statistical = (v, scale, name) => v === null ? 0 : scale * Math.tanh(number(v, name, -10, 10) / 2);
  const components = {
    match: matchComponent(matches),
    qualification: 21 * (qualificationActual - qualificationExpected),
    elimination: 39 * (eliminationActual - eliminationExpected),
    contribution: statistical(contributionResidual, 8, 'contribution residual'),
    auto: statistical(autoResidual, 4, 'auto residual'),
  };
  const base = Object.values(components).reduce((a, b) => a + b, 0);
  const eventWeight = EVENT_WEIGHTS[tier];
  const negativeWeight = clamp(1 / eventWeight, .8, 1.25);
  const weighted = base * (base >= 0 ? eventWeight : negativeWeight) * reliability;
  // Explicit achievement policy, NOT a claim about pure predictive Elo.
  // <=25% frozen title chance qualifies as an unexpected champion.
  const championFloor = champion ? (titleProbability <= .25 ? 8 * eventWeight * (1 - titleProbability) * reliability : 0) : null;
  const achievementCorrection = champion ? Math.max(0, championFloor - weighted) : 0;
  const uncappedDelta = weighted + achievementCorrection;
  const delta = clamp(uncappedDelta, -100, 100);
  return { version: 'VCR-3.0-candidate', ratingBefore: rating, ratingAfter: rating + delta,
    delta, components, base, eventWeight, negativeWeight, reliability, weighted,
    championFloor, achievementCorrection, capAdjustment: delta - uncappedDelta };
}
