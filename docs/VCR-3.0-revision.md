# VCR 3.0 candidate: event settlement and achievement

Date: 2026-09-09. Status: executable, scenario-tested candidate; not deployed or historically calibrated.

## Source and findings

Reviewed [the project's Lucidchart](https://lucid.app/lucidchart/155358d5-0829-4c12-bbc1-64ef25e11112/edit), specifically pages 03 (team rating) and 04 (event rating and finish). The diagram is titled VCR v1.0 and still uses the older 65/20/10/5 blend, 35–65% partner shares, and 55/45 qualification/elimination split. This revision supersedes those branches while retaining frozen expectations, event tiers, data reliability and auditable settlement.

Confirmed implementation differences:

- `website/app/api/teams/[number]/route.ts` estimates every opponent as 1500. A team can appear to underperform simply because its actual strong opponents are treated as average. That calculation omits its partner's strength too.
- The same route sums match changes without a tournament-result component. Winning eliminations does not necessarily outweigh qualification losses.
- The leaderboard and historical builder use a different, alliance-aware match model. Team history therefore does not describe the same rating shown on the leaderboard.
- Live rankings read only selected event pages, the last 36 completed events, two divisions per event and one match page per division. Historical generation keeps only three divisions. An incomplete field can miss elimination results or introduce unstable ratings.
- The diagram multiplies a finish update by only 5%. A nominal +80 finish component contributes only +4 after blending. This explains a structural possibility, not a verified diagnosis of a particular team's result: no team/event identifier was supplied.

## What score means

VCR combines estimated performance with an explicit achievement policy. Pure predictive Elo can legitimately fall after a championship if a heavily favored team underperforms overall; the product requirement here is different. A verified champion receives a nonnegative event change, and an unexpected champion receives a positive minimum when evidence reliability is positive.

This policy is disclosed rather than disguised as probability estimation. If a separate prediction rating is needed, keep it separate from VCR. A gain in VCR cannot guarantee a gain in ordinal rank because other teams may gain more.

## Frozen inputs and processing

Before the event, persist model version, entrant ratings, division membership, event tier, expectations and a timestamp. Use real ratings for all four robots. Unknown teams have a neutral 1500 prior with high uncertainty, not a fictitious known rating. Never compute missing opponent ratings from the subject team's own history.

The scoring core accepts normalized evidence and returns an event ledger. It does not fetch data, infer champions, fit OPR, or silently replace missing statistics. The adapter must verify a completed bracket and derive champion status from results, never judged awards or merely one final-match win. Division champion and overall Worlds champion must be separate scopes; allocate one settlement per defined scope without duplicating the same matches.

Compute local partner shares from earlier matches only, bounded at 20–80%; use 50/50 when attribution is unreliable. Cap based on confidence in local evidence, not global-rank gap, so a new team can demonstrate a larger contribution.

## One numerical settlement

All quantities below are internal rating points, centered at 1500. Do not multiply these components by another percentage blend.

For a match, alliance ratings are the means of participating robots:

```text
E = 1 / (1 + 10^((opponentAllianceRating - ownAllianceRating)/400))
MOV = 1 + 0.25*tanh(abs(scoreMargin)/scoreScale)
residual = (actual - E)*MOV*2*partnerShare
```

Actual is 0, 0.5 or 1. Ties use MOV=1. scoreScale must be positive, game-specific, and available at prediction time. The multiplier 2 preserves the per-team scale at a 50/50 split. Equivalent opposing results use the same margin magnitude. Match reliability is 0–1.

```text
n = sum(matchReliability)
M = 40 * weightedMean(residual) * min(1,n/6)
Q = 21 * (qualificationActual - qualificationExpected)
L = 39 * (eliminationActual - eliminationExpected)
C = 8 * tanh(contributionResidual/2)
A = 4 * tanh(autoResidual/2)
B = M + Q + L + C + A
```

M is zero with no valid match evidence. Six effective matches saturate match evidence, so a long schedule does not automatically accumulate more credit. Q and L retain a 35/65 split of the 60-point tournament evidence scale. C and A are standardized residuals relative to frozen expectations, not raw OPR or event position. They are bounded at ±8 and ±4. Missing values contribute zero and remain marked missing. OPR and DPR can inform C, but CCWM=OPR−DPR cannot be counted as an independent third signal. If detailed autonomous attribution is unavailable, omit it rather than fabricate it.

QualificationActual is `(N-rank)/(N-1)` within the relevant division (neutral 0.5 for N=1). QualificationExpected is the mean of that exact quantity under a frozen schedule model. EliminationActual is the bracket outcome utility: champion 1, finalist .85, semifinal .65, quarterfinal .45, round-of-16 .25, no elimination .0. Apply these to the actual stage reached, with byes not counted as wins. Other formats need a versioned utility mapping. EliminationExpected must be the expected value of this same utility, not a win probability or global-rank percentile.

The reference core deliberately requires these expectations as inputs. A production adapter should simulate the actual schedule and bracket from frozen ratings (10,000 trials, persisted seed and output). Before selection, an explicit selection model is required; otherwise publish the finish component as provisional rather than claiming precise expectations. TitleProbability is the frozen probability of winning the specified scope. It is not recalculated after the team starts winning.

## Event Weight

| Tier | Positive weight | Negative weight |
|---|---:|---:|
| C | .70 | 1.25 |
| B | .82 | 1.219512 |
| A | .95 | 1.052632 |
| Bronze S | 1.15 | .869565 |
| Silver S | 1.35 | .80 |
| Gold S | 1.60 | .80 |
| Worlds | 1.85 | .80 |

```text
negativeWeight = clamp(1/EventWeight, .80, 1.25)
weighted = B * (B>=0 ? EventWeight : negativeWeight) * eventReliability
```

Apply this once to the event aggregate, not independently to every positive and negative component. The bounds stop weak events from creating extreme penalties and stop major events from almost excusing failures. Regional strength enters the frozen field estimate, not a second country multiplier. Uncertainty in disconnected regions should affect confidence.

Retain the diagram's ESS thresholds: C below 35, B below 50, A below 65, Bronze S below 75, Silver S below 88, Gold S otherwise. Ordinary and regional events are capped at Bronze S; Signature classes range Bronze through Gold S; Worlds is special. Tier is frozen before results. The core accepts a verified tier and does not infer one from branding.

## Champion correction

```text
if verified champion and frozen titleProbability <= .25:
    floor = 8 * EventWeight * (1-titleProbability) * reliability
else if verified champion:
    floor = 0
else:
    no floor

achievementCorrection = champion ? max(0, floor-weighted) : 0
eventDelta = clamp(weighted+achievementCorrection, -100, 100)
ratingAfter = ratingBefore + eventDelta
```

At a 10% title probability, unexpected champion floors are C +5.04, B +5.904, A +6.84, Bronze S +8.28, Silver S +9.72, Gold S +11.52, Worlds +13.32 (reliability 1). These are minimums, not automatic extra bonuses; strong natural performance remains unchanged. Reliability zero gives no update. An incomplete tournament cannot settle. The .25 threshold is a proposed policy constant, subject to review and historical testing.

Example: six effective matches with mean residual −.30 yield M=−12. A qualification surprise of −.40 yields Q=−8.4. An elimination surprise of +.60 yields L=+23.4. Contribution residual −2 gives C≈−6.093; missing auto gives A=0. B≈−3.093. At Gold S the negative weighting yields ≈−2.474. For a champion with a pre-event title chance of .10, the explicit correction is ≈+13.994, giving +11.52. The ledger exposes every step.

The champion rule introduces upward pressure and can reward a carried partner. It is intentionally modest and bounded, while share estimates govern other credit. Measure inflation and schedule incentives during backtesting. Do not subtract a hidden population correction after this floor; that would break the guarantee.

## Time, confidence and publication

Settle an event at one reference timestamp. Record eventDelta separately from later aging, uncertainty and rank movement. A 75-day half-life can weight evidence for a later predictive refit; do not retrospectively scale each historical update by today's age and call the result the original event change. Never apply both decayed updates and decayed evidence to the same signal.

A 1500-centered internal score is authoritative in this candidate; a public transformation can be applied consistently afterward. Display the raw event gain and any separate aging/uncertainty change. The core neither changes RD nor promises that a conservative public score cannot move due to separately modeled uncertainty.

## Implementation and verification

Executable source: `algorithm/vcr-event.mjs`. Tests: `algorithm/vcr-event.test.mjs`. Run from the repository root:

```sh
node --test algorithm/vcr-event.test.mjs
```

Tests cover all tiers, adverse component evidence for champions, legitimate non-champion losses, tier monotonicity, symmetric margin treatment, saturated match samples, missing data, incomplete events, nonfinite values, caps and audit reconciliation.

This is a tested replacement settlement core, not an assertion that the website already uses VCR 3.0. The existing API routes and static historical JSON still use their legacy calculations. Integration requires complete paginated field data, frozen expectations, verified tournament scopes and a shared event ledger read by both leaderboard and team history. Rebuilding old leaderboards from summary-only JSON cannot recover those inputs. Evaluate prediction accuracy and champion corrections on historical raw matches before production publication.
