# Ceres Agent

Ceres is a focused marketing-research demo. It analyzes a labeled synthetic event dataset, plans the claims and missing information that matter, uses Linkup Search and Fetch to investigate a conversion weakness, checks exact source passages, and produces either a bounded hypothesis or an explicit inconclusive conclusion. It can also expose an optional read-only PostHog MCP connection for direct live analytics.

The persisted evidence-review workflow intentionally has one sample project. Its analytics use sample events; records can be saved in PostgreSQL or a local file. Live PostHog queries remain separate from that sample workflow.

## Run locally

Use Node.js 24+.

1. Run `npm install`.
2. Copy `.env.example` to `.env.local` and set Linkup and basic-auth credentials. PostHog is optional. The outer Eve agent supplies the reasoning model; Ceres does not require a second model API key.
3. Run `npm run dev` with the environment loaded.

To save records in PostgreSQL, set `DATABASE_URL` in `.env.local` and run `npm run db:migrate` before starting the app. The migration is repeatable and creates `ceres_documents` (latest records) and `ceres_document_revisions` (history). Each document has a `kind`, `run_id`, and JSONB `snapshot` containing the full evidence and validation fields. Insights, research findings and assessments, research decisions, hypotheses, analytics snapshots, and workflow state all use the same database. Configured database failures surface as errors; they do not fall back to files.

Without `DATABASE_URL`, the default record path is `.eve/ceres-records.jsonl`. Set `CERES_DATA_PATH` to change it. Existing file records are not automatically imported into PostgreSQL.

## Optional PostHog MCP

Set `POSTHOG_PERSONAL_API_KEY` to expose live PostHog analytics to Ceres through PostHog's hosted MCP endpoint. `POSTHOG_MCP_URL` defaults to `https://mcp.posthog.com/mcp`, `POSTHOG_MCP_VERSION` defaults to `2`, and `POSTHOG_PROJECT_ID` is an optional non-secret identifier used to isolate connection state. The connection supports both individual analytics tools and the hosted `exec` interface. A server-side policy checks the operation inside every `exec` command against a read-only allowlist and denies create, update, and delete operations.

When `POSTHOG_PERSONAL_API_KEY` is empty or absent, the PostHog connection is not registered. Ceres then uses the built-in event sample and explicitly labels its output as synthetic mock data. Once PostHog is configured, connection errors are reported and do not trigger a silent mock fallback. The `analysis_workflow` remains bound to the synthetic sample, so direct PostHog results are not currently persisted into its evidence-review state.

After changing PostHog environment variables, restart or redeploy the running Eve host and begin a new agent session. For local development, make sure `POSTHOG_PERSONAL_API_KEY` is non-empty in `.env.local` before starting `npm run dev`. Tool discovery is keyword-based; the agent uses exact capability terms such as `exec execute SQL events` and retries an unmatched search instead of treating it as an empty PostHog tool catalog.

To populate PostgreSQL with mock evidence-review data, run `npm run db:seed` after migrating. Each invocation adds one partial-evidence run with an exploratory experiment and one inconclusive run without a hypothesis, using no external APIs. See the [seed and pgAdmin guide](docs/database-seeding.md) for setup, table navigation, and verification queries.

Ask:

> Using the sample analytics from September 7–10, 2026, research a conversion weakness, investigate a gap from a saved finding, and save an experiment. Check whether you have a tool to apply the changes; otherwise explain what you would change.

The exact sample period is `2026-09-07T00:00:00Z` through `2026-09-10T12:00:00Z`. The agent advances the server-enforced `analysis_workflow` one transition at a time: plan claims and gaps, search, optionally Fetch decisive pages, assess claim-level passages, then submit a hypothesis or complete without one. For analytics without web research, `start` accepts `research=false`. The `read_records` tool exposes the saved evidence and revision history.

## Experiment proposals

After completing research with a hypothesis, the agent uses `save_experiment` to persist a proposal. Experiments inherit claims, evidence assessments, gaps, research status, and uncertainties. Partial or inconclusive research only permits `exploratory` intent with concrete prerequisites; `confirmatory` intent requires supported research. Unknown page content or product behavior must be labeled as assumptions.

With `DATABASE_URL`, experiments are stored in `ceres_documents` with `kind = 'experiment'`, alongside their revision history in `ceres_document_revisions`. The existing migration already supports this kind. Without PostgreSQL, they use the same local file store as other records. Use `read_records` with `kind = 'experiment'` to inspect proposals. Identical submissions against the same hypothesis version are idempotent; different proposals can share a hypothesis. Saved experiments remain historical proposals even if their hypothesis later expires.

The agent checks its actual session tools for one capable of making the proposed changes. The demo has no external action tool, so it records a manual handoff and explains what the user would change. A reported tool match in a future session is an agent assessment, not server-verified capability or proof of execution. Saving always sets `status = 'proposed'` and `execution_status = 'not_started'`; this feature does not execute, track, or evaluate experiments.

## What the demo proves

- Conversion metrics retain their numerator, eligible denominator, population, and period.
- External research cannot replace missing analytics.
- Claims and material gaps are persisted before research begins.
- Findings are saved before they can influence a follow-up search.
- Supported, refuted, mixed, and insufficient evidence records cite exact stored passages.
- Tool order, state versions, evidence references, Search budgets, and Fetch budgets are enforced server-side.
- Empty research can be reformulated within budget and can finish honestly without a hypothesis.
- `sufficient_evidence` requires supported decisive claims, no open blocking gap, and a searched and resolved challenge gap.
- Final hypotheses and experiments preserve structured gaps and distinguish supported from exploratory work.

## Verification and deployment

Run `npm test`, `npm run typecheck`, and `npm run build`.

To run the workflow and persistence tests against PostgreSQL, use `TEST_DATABASE_URL=postgresql://... npm test`. Tests create and remove isolated schemas; the test user needs schema-creation privileges. Without this variable, workflow tests use files and the Postgres-specific test is skipped.

For an optional real-provider smoke run:

```sh
node --env-file=.env.local --experimental-transform-types scripts/live-research.ts
```

Railway uses `railway.json`. Set `DATABASE_URL` to the Postgres service connection URL and run the migration with that environment before deploying. For file storage, mount a persistent volume at `/app/.eve` and set `CERES_DATA_PATH=/app/.eve/ceres-records.jsonl`.

Connecting real analytics, multi-project administration, public visitor isolation, scheduling, automatic revalidation, and cleanup are explicitly deferred until the demo validates demand.

Verify live tool discovery and querying with `node --experimental-transform-types scripts/live-posthog.ts` while `npm run dev` is running. This asks Ceres to analyze 2wander.space over the last 180 days, asserts successful SQL execution and a completed response, and writes the session transcript and answer under `.eve/live-results/`.
