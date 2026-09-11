# Ceres pre-build evaluations

This implements the evaluation harness in [`eval_plan.md`](../eval_plan.md), without implementing the product roadmap. A green calibration run proves the graders can distinguish synthetic good and bad evidence. It does **not** establish that the product works. Missing product, UI, or deployment bindings remain `blocked`.

## Run

Requires Node >=24 and the repository's installed dependencies (`npm ci` for a fresh checkout).

```sh
npm run eval:typecheck
npm run eval:calibration
npm run eval:contracts
npm run eval:agent
npm run eval:browser
npm run eval:live
npm run eval:release
```

Each layer command runs harness calibration first, then its acceptance cases. `eval:agent` runs each research scenario three times; every repetition must pass. This is a smoke gate, not a reliability estimate. Select one case with `npm run eval:contracts -- --case S1-06`. Release mode prohibits selection and verifies an independent registry of all 42 required IDs, including both API and browser coverage where required.

| Status | Meaning | Pre-build exit | Release exit |
| --- | --- | --- | --- |
| `pass` | Required observable assertions passed | Success | Success |
| `fail` | Observed behavior violated a requirement | Failure | Failure |
| `blocked` | Product capability, binding, or required setup absent | Allowed, disclosed | Failure |
| `infrastructure_error` | Configured infrastructure failed to execute | Failure | Failure |

A permissions, isolation, fabricated-evidence, or budget failure cannot be averaged away. Release acceptance requires every case and repetition plus harness calibration to pass. A provider outage remains in its original report; reruns create new reports.

## Fixtures and calibration

- `fixtures/analytics.json`: six explicit visitors, overlapping tab membership, initial sessions, signup timing, and independent expected counts. Calibration derives ground truth from visitor rows. My Channels is 1/2 same-session and 2/2 within 48 hours; Discovery and Search are each 1/3 and 2/3. This small sample establishes neither causal nor statistical superiority. A one-hour window produces 1/2, 1/3, 1/3. Duplicates, missing identity/conversion mapping, immature cohorts, and zero denominators require separate checks. TTUR 30/50 is separate from metric 13/15, with exclusions retained.
- `fixtures/research.json`: synthetic `.test` evidence for onboarding/setup (B1) and acquisition/audience intent (B2), contradictions, irrelevant sources, injected instructions, and provider failure variants. Both branches receive the same user task. Retrieved text is evidence, never authorization.
- `fixtures/policies.json`: **test-only** weekly proactive cap 2; Monday 00:00 UTC reset; three Linkup attempts per run including retries; hourly activity checks; full-analysis bounds 24 hours–7 days. These do not settle product defaults.
- `tests/graders.test.ts`: accepts a synthetic good trace and rejects wrong denominators, invented citations, follow-up before persistence, workspace leaks, excessive provider attempts, and expired premises. Further mutations exercise missing and malformed evidence.
- `graders/research-rubric.md`: five semantic dimensions, each 0–2, requiring >=8/10 and no zero after hard checks pass. Calibration examples are synthetic; they are not evidence of human review of product output. Human review of borderline results remains required.

Expected outcomes belong to the harness. Product bindings receive user requests and raw fixture data/provider responses, **never** expected counts, scoring answers, or private grader instructions. Injection must happen at analytics/provider/clock boundaries while executing real workflow logic.

## Bind the product

`drivers/ceres.ts` implements the plan's shared `CeresEvalDriver` interface. Supply an absolute path or file URL in `EVAL_CERES_DRIVER_MODULE`. The module exports `createEvalBindings()` returning:

```ts
{
  operations: { /* operation name -> async (input) => actual workflow result */ },
  inspect: async (workspaceId) => /* independently read persisted state */,
  trace: async (runId) => /* ordered public tool/evidence events */,
  advanceClock: async (isoTime) => /* injected server clock */,
  close: async () => /* release isolated resources */,
}
```

Each case file defines its operation input and observable snapshot/trace contract. Operation names are evaluation adapters, not proposed production endpoints. Adapters must exercise actual authorization, transactions, persistence and workflow logic. Returning hardcoded expected states or taking a final model answer's claims as proof is invalid integration coverage. `inspect` must reread storage, and `trace` must be recorded at tool/persistence boundaries. Do not collect private chain of thought.

Absent operations throw `BlockedCapabilityError`. The current product has analytics and Linkup tools but no persistent insight/hypothesis workflows, scoped public API, lifecycle scheduler, or demo UI. New implementations should bind those capabilities incrementally. Scoring remains separately blocked until a versioned formula and independently hand-calculated examples exist; injected 79/80 validator results only cover activation policy.

## Disposable PostgreSQL

Set `EVAL_DATABASE_ADMIN_URL` explicitly to a **disposable** PostgreSQL server, with permission to create databases and roles. The helper creates random `ceres_eval_*` database/owner/analytics roles and tears down only those resources. Remote server URLs require an explicitly test/eval database name. No production `DATABASE_URL` fallback is used, and `.env.local` is not loaded.

```sh
EVAL_DATABASE_ADMIN_URL='postgresql://test_admin:password@127.0.0.1:5432/postgres' npm run eval:contracts -- --case S1-06
```

S1-06 checks real mutation attempts, grants, and before/after state as well as the existing analytics tool. Creating a read-only test role establishes the harness fixture; eventual product deployment authorization must also be bound and verified. SQL prefix rejection alone is insufficient. Missing explicit DB configuration is `blocked`; connection/setup failure after configuration is `infrastructure_error`.

## Browser and live acceptance

Browser cases specify accessible, persistent-state journeys with isolated visitor contexts and private test-deployment clock control. UI selection and Playwright configuration are intentionally deferred until real routes/screens exist, as the plan specifies. A missing browser binding is reported rather than silently passing a skipped journey. Never expose fake-clock controls to public callers.

Live Linkup acceptance is opt-in, requires real environment-supplied credentials and a deployed workflow binding, and never substitutes fixtures. See `live/linkup.ts` for its explicit opt-in and operation contract. S2-11 requires real retrieval, a saved finding before a dependent follow-up, a linked final hypothesis, and visitor-visible evidence under the call limit. A single successful search does not satisfy this demonstration gate. The deployed outsider journey and redacted screenshots must still be captured when a deployment exists.

## Reports

Every command writes `evals/results/<run-id>/results.json` and `summary.md`. Reports include case IDs, layer, repetition, assertions, status, duration, hashes of fixtures/prompts/skills/agent config/dependencies/harness, and adapter metadata/trace references when available. Adapters must record actual model, reasoning setting, tool limits and provider attempts; environment labels alone do not prove runtime settings. Secrets in credential fields, environment credential values, database URLs, and bearer tokens are redacted before output; only public evidence belongs in traces. Reports are gitignored. Do not commit credentials or production datasets.

The execution baseline and remaining external prerequisites are recorded in `IMPLEMENTATION.md`. Full MVP acceptance remains blocked until all product, browser, scorer, and live deployed requirements pass.
