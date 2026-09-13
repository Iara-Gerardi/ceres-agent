# Ceres Agent

Ceres is a focused marketing-research demo. It analyzes a labeled synthetic event dataset, uses Linkup to investigate a conversion weakness, saves each research step, and produces a tentative hypothesis and a persisted experiment proposal with sources and uncertainty.

The MVP intentionally has one sample project. Analytics use sample events; records can be saved in PostgreSQL or a local file.

## Run locally

Use Node.js 24+.

1. Run `npm install`.
2. Copy `.env.example` to `.env.local` and set Linkup and basic-auth credentials. The outer Eve agent supplies the reasoning model; Ceres does not require a second model API key.
3. Run `npm run dev` with the environment loaded.

To save records in PostgreSQL, set `DATABASE_URL` in `.env.local` and run `npm run db:migrate` before starting the app. The migration is repeatable and creates `ceres_documents` (latest records) and `ceres_document_revisions` (history). Each document has a `kind`, `run_id`, and JSONB `snapshot` containing the full evidence and validation fields. Insights, research findings and assessments, research decisions, hypotheses, analytics snapshots, and workflow state all use the same database. Configured database failures surface as errors; they do not fall back to files.

Without `DATABASE_URL`, the default record path is `.eve/ceres-records.jsonl`. Set `CERES_DATA_PATH` to change it. Existing file records are not automatically imported into PostgreSQL.

To populate PostgreSQL with a complete mock analysis run, run `npm run db:seed` after migrating. Each invocation adds a new run with insights, research, and a hypothesis, using no external APIs. See the [seed and pgAdmin guide](docs/database-seeding.md) for setup, table navigation, and verification queries.

Ask:

> Using the sample analytics from September 7–10, 2026, research a conversion weakness, investigate a gap from a saved finding, and save an experiment. Check whether you have a tool to apply the changes; otherwise explain what you would change.

The exact sample period is `2026-09-07T00:00:00Z` through `2026-09-10T12:00:00Z`. The agent advances the server-enforced `analysis_workflow` one transition at a time. For analytics without web research, its `start` action accepts `research=false`. The `read_records` tool exposes the saved evidence and revision history.

## Experiment proposals

After completing research, the agent uses `save_experiment` to persist a proposal linked to the current hypothesis. Experiments include the audience, control and treatment changes, rationale, primary metric, success criterion, guardrails, inherited evidence IDs and uncertainties, and the agent's assessment of available action tools. Unknown page content or product behavior must be labeled as assumptions.

With `DATABASE_URL`, experiments are stored in `ceres_documents` with `kind = 'experiment'`, alongside their revision history in `ceres_document_revisions`. The existing migration already supports this kind. Without PostgreSQL, they use the same local file store as other records. Use `read_records` with `kind = 'experiment'` to inspect proposals. Identical submissions against the same hypothesis version are idempotent; different proposals can share a hypothesis. Saved experiments remain historical proposals even if their hypothesis later expires.

The agent checks its actual session tools for one capable of making the proposed changes. The demo has no external action tool, so it records a manual handoff and explains what the user would change. A reported tool match in a future session is an agent assessment, not server-verified capability or proof of execution. Saving always sets `status = 'proposed'` and `execution_status = 'not_started'`; this feature does not execute, track, or evaluate experiments.

## What the demo proves

- Conversion metrics retain their numerator, eligible denominator, population, and period.
- External research cannot replace missing analytics.
- Findings are saved before they can influence a follow-up search.
- Tool order, state versions, evidence references, and research budgets are enforced server-side.
- Linkup calls are bounded and repeated or empty research stops early.
- Final hypotheses cite stored evidence, preserve uncertainty, and suggest a test without claiming causality.

## Verification and deployment

Run `npm test`, `npm run typecheck`, and `npm run build`.

To run the workflow and persistence tests against PostgreSQL, use `TEST_DATABASE_URL=postgresql://... npm test`. Tests create and remove isolated schemas; the test user needs schema-creation privileges. Without this variable, workflow tests use files and the Postgres-specific test is skipped.

For an optional real-provider smoke run:

```sh
node --env-file=.env.local --experimental-transform-types scripts/live-research.ts
```

Railway uses `railway.json`. Set `DATABASE_URL` to the Postgres service connection URL and run the migration with that environment before deploying. For file storage, mount a persistent volume at `/app/.eve` and set `CERES_DATA_PATH=/app/.eve/ceres-records.jsonl`.

Connecting real analytics, multi-project administration, public visitor isolation, scheduling, automatic revalidation, and cleanup are explicitly deferred until the demo validates demand.
