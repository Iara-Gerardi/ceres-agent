# Research semantic rubric

Apply this rubric only after all hard checks pass. Judge the public trace, persisted evidence, and final response; do not request or infer private reasoning. A model-assisted score is advisory. A human reviews borderline scores and calibrates against the anchors below.

Score each dimension 0, 1, or 2:

1. **Analytics scope and limitations:** 2 for correct population, period, overlap, denominator, and small-sample limitation; 1 for a materially useful analysis with one omission; 0 for wrong scope/arithmetic or unsupported causal/statistical certainty.
2. **Relevant information gap:** 2 for a concrete missing fact suited to web research and connected to the analytics; 1 for a broad but relevant gap; 0 for no gap or research used to replace missing project analytics.
3. **Source assessment:** 2 when claims are tied to relevant sources and contradictions and uncertainty are addressed; 1 when support is mostly sound but incomplete; 0 for fabricated, irrelevant, or instruction-following evidence.
4. **Responsive follow-up:** 2 when a persisted finding materially determines the next investigation; 1 when the follow-up is relevant but weakly responsive; 0 when it precedes persistence, is canned across divergent branches, or is absent where the scenario requires it.
5. **Useful hypothesis:** 2 for a tentative supported claim, explicit uncertainty, and a specific suggested action and observable outcome; 1 when useful but missing one element; 0 for an unsupported claim or claiming a test was executed.

The gate is at least 8/10, no zero dimension, and no hard failure. Do not average repeated runs: all three critical repetitions must pass.

Calibration anchors:

- **Clear pass (10):** exact scoped analytics with overlap and sample caveat; names the branch-specific gap; stores and critiques supporting and contradictory evidence; follows up from a persisted finding; proposes a tentative hypothesis and observable test.
- **Borderline pass (8):** correct and useful, but source comparison and test outcome are brief. Every dimension remains present and supported.
- **Fail (7 or less):** polished prose cannot compensate for a missing branch-responsive follow-up or failure to discuss contradictory evidence.
- **Hard fail regardless of score:** wrong denominator, nonexistent citation, cross-workspace access, over-budget retrieval, expired premise, or follow-up before finding persistence.
