# Foundation and research implementation decisions

The core workflow is in `core/workflow.ts`; adapters implement storage, analytics, Linkup, and structured model decisions. Project-specific event names and populations are confined to removable configuration and sample data.

## Contracts and policy versions

All application IDs use UUIDv7 and UTC timestamps. `ceres.documents` stores structured analytics snapshots, insights, hypotheses, findings, research decisions, attempts, stop events, failures, and runs. `ceres.history` keeps every committed revision and operation ID in the same transaction as its record. Optimistic versions reject stale updates. Retrying an operation ID returns its original committed revision. Callers must use a different operation ID for different mutations.

Authorization derives from the server-bound workspace and owner. Reads, writes, history, and source lookup check the workspace; RLS additionally protects document and history tables for the runtime role. Expired workspaces reject operations. The agent has no database credentials in its context, no arbitrary SQL tool, and no permanent deletion tool.

`evidence-v1` awards 15 points each for data availability, valid metric definitions, consistent counts, and traceable sources; 20 for meeting the configured minimum sample; 10 for complete supported analysis windows; and 10 for complete snapshot usage coverage. The first four checks are mandatory and cannot be disabled through project settings. Each validation saves its results, reasons, score, and rule version. Insight activation requires all mandatory checks and score >=80. Hypotheses require mandatory checks and a nonempty suggested test, with no score floor. Hypotheses remain tentative regardless of score. The default minimum sample is 30 eligible visitors and TTQ is 168 hours. These are initial product policies, not statistically calibrated confidence measures.

Unknown or zero-denominator rates remain undefined. Numerator/eligible denominator is stored separately from evidence usage. Analytics snapshots retain the returned events, mappings, period, sample label, and analysis failures. Sample data uses six visitors, overlapping groups, and same-session plus inclusive 48-hour conversion. Session conversion is observed through the cutoff; the source session definition must be appropriate to the project.

Syntactically invalid or spoofed tool payloads are rejected before writing. Structurally valid candidates that fail evidence or activation requirements are saved inactive. Missing project data creates a failure record without an invented candidate. If a workflow fails after generating candidates, its saved insights are deactivated. History preserves their earlier revisions.

## Research boundaries

A requested creation run owns every Linkup attempt. The default is three provider attempts, five results per search, 45 seconds per retrieval, 60 seconds per model step, and no SDK retries. The live adapter uses Linkup's [searchResults endpoint](https://docs.linkup.so/pages/documentation/endpoints/search/reference), which retrieves source content along with URLs and titles.

Every result is committed before assessment. An assessment records relevance, supported summary, uncertainty, and contradictions while preserving the returned content. Subsequent searches must cite saved finding IDs, and final hypothesis validation rejects missing, foreign, irrelevant, or unusable supporting records. The model performs semantic relevance/support assessment; the backend enforces identifiers, persistence, validation, budgets, and boundaries. Retrieved content never grants tool authority.

Stop events retain sufficient/diminishing-value decisions, repeated queries, empty results, provider failures, or budget exhaustion, plus unresolved questions. Budget exhaustion alone does not invalidate a supported hypothesis. No research is forced for analytics-only requests. Current record filtering excludes expired, deleted, inactive, and manually invalidated premises.

## Verification and remaining acceptance work

`tests/foundation.test.ts` and `tests/research.test.ts` exercise real PostgreSQL persistence and deterministic provider/model adapters: hand-calculated scoring, inactive failures, ratio snapshots, schema spoofing, isolation, history, retry, rollback, analytics grants, exact conversion counts, event/configuration swaps, duplicate events, immature cohorts, missing identity, branching follow-ups, final support, provider failure, and analytics-only behavior.

The existing `evals/` scenario driver is still an integration point, not a completed S1/S2 release certification. The deterministic product tests are the implemented acceptance evidence; broader semantic rubric runs and deployed S2-11 remain outstanding. Do not describe calibration-only passes as product acceptance.

Initial live verification reached the model provider but its configured local key was rejected with HTTP 401 (`invalid_api_key`), before any workflow Linkup call. A full live persisted research loop needs valid model credentials. Deployment and an outsider journey remain step 3.

An independent live Linkup search succeeded and returned two source URLs with retrieved content. This verifies adapter connectivity, not the complete live model-driven research loop.

Final local checks: 11 product tests passed; application and eval TypeScript checks passed; S1-SCORER passed; 40 calibration checks passed with 24 product cases intentionally skipped in calibration mode; Eve production build passed. These results do not satisfy the unbound full release gate.
