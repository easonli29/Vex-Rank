# VCR 3.0 candidate

Status: candidate, not deployed or historically calibrated.

Predecessor: VCR 2.0 on main. This branch adds the new model without replacing the previous documentation or website calculations.

- [Specification and rationale](../docs/VCR-3.0-revision.md)
- [Executable event settlement](../algorithm/vcr-event.mjs)
- [Regression tests](../algorithm/vcr-event.test.mjs)

Changes: stronger elimination evidence, bounded statistical penalties, Event Weight applied once, explicit minimum gain for unexpected champions, and a reconciled event audit breakdown.

Validation: `node --test algorithm/vcr-event.test.mjs` passes all 9 tests. Historical calibration and live-data integration remain outstanding. The existing API and historical JSON still use the older calculations.
