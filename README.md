# Ceres Agent

Ceres implements the backend for GOALS.md roadmap steps 1 and 2: configured analytics, validated saved insights, and bounded Linkup research producing a tentative hypothesis with sources, uncertainty, and a suggested test. The existing Eve interface exposes the tools behind HTTP basic authentication.

Use Node.js 24+. Run `npm install`, copy `.env.example` to `.env`, and configure server credentials. The outer Eve agent retains its existing model configuration in `agent/agent.ts`. The internal structured research model uses `OPENAI_API_KEY`, or `AI_GATEWAY_API_KEY` when no direct key is present; `CERES_RESEARCH_MODEL` defaults to `gpt-5.4`.

1. Provision a PostgreSQL database for Ceres records, separate from analytics. Set `CERES_MIGRATION_DATABASE_URL` to its administrative login.
2. Run `npm run db:migrate` with environment variables loaded. The migrations create tables, workspace RLS, and a `ceres_runtime` privilege group.
3. Provision a non-owner, non-superuser login without `BYPASSRLS`, grant it `ceres_runtime`, and put its URL in `CERES_DATABASE_URL`. Do not use the migration login at runtime.
4. Set `CERES_OWNER_ID`; run `npm run db:seed` and set the printed `CERES_WORKSPACE_ID`. This creates a workspace with the labeled sample configuration. Seed is idempotent and does not overwrite existing configuration.
5. Set `LINKUP_API_KEY`, model credentials, and basic-auth credentials. Run `npm run dev`.

The scripts use the process environment. For a local `.env` file, for example: `node --env-file=.env --experimental-transform-types scripts/migrate.ts`, then the corresponding `scripts/seed.ts` command.

Ask: “Using the sample analytics from September 7–10, 2026, research a conversion weakness, investigate a gap from a saved finding, and suggest a test.” The exact sample period is `2026-09-07T00:00:00Z` through `2026-09-10T12:00:00Z`. For analytics without web research, the `request_analysis` tool accepts `research=false`.

`read_records` exposes records and revision history. `save_candidate` performs validated creation/revision using a stored run. `soft_delete_record` records a reason and excludes the record from current reasoning. Agent tools cannot permanently delete records, submit arbitrary SQL, alter workspace scope, or perform detached Linkup searches.

To connect project data, seed a removable configuration matching `core/contracts.ts` with `sample=false`. Supply `ANALYTICS_DATABASE_URL` using a SELECT-only role on an explicitly approved analytics view, and `CERES_ANALYTICS_QUERY`, a server-owned SELECT using `$1`/`$2` bounds. It must return `visitor`, `session`, `event`, nullable `group`, and ISO UTC text `at`. The view must implement the project's verified anonymous/account identity mapping. The adapter enforces a read-only transaction, five-second query timeout, and 10,000-row maximum. Do not grant analytics privileges to the Ceres storage role or use an analytics administrator login.

Run checks with `npm test`, `npm run typecheck`, `npm run eval:calibration`, and `npm run build`. Product tests use a real embedded PostgreSQL engine (PGlite) with migrations, RLS, grants, and transactional failure injection. The pre-existing broader eval harness still has unbound scenario operations; its release gate is not claimed to pass. See [implementation decisions and coverage](docs/foundation-research.md).

For an optional real-provider smoke run: `node --env-file=.env --experimental-transform-types scripts/live-research.ts`. It uses synthetic analytics and embedded local storage, makes at most three Linkup calls, and writes an inspectable evidence report under `evals/results/live-local/`. It is not a deployed outsider acceptance test.

Railway continues to use `railway.json`. Configure the same runtime environment, keep basic auth enabled, and attach a volume at `/app/.eve/.workflow-data` for Eve's workflows. Run database migrations separately before starting the service.

Public visitor sessions, deployment acceptance, monitoring, scheduler, automated revalidation, and cleanup remain roadmap steps 3–4.
