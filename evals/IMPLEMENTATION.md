# Evaluation implementation status

Implemented from `eval_plan.md` on the existing `linkup` branch. Product workflows and GOALS.md were not changed. Existing package/package-lock edits were preserved; changes are uncommitted.

## Delivered

| Plan task | Evaluation artifacts | Execution status |
| --- | --- | --- |
| 1 — Ground truth and calibration | Shared contracts, fixtures A–C, injected clock, hard graders, semantic rubric and synthetic anchors, mutation tests | Calibration passes |
| 2 — Foundation | All S1-01–12 protocols, explicit driver binding points, disposable PostgreSQL helper, real analytics-tool subprocess binding | Product/DB checks blocked; separate S1-SCORER gate records undefined formula |
| 3 — Research | S2-01–10 scenarios, separate branch/failure runs, source/persistence/attempt checks, semantic review requirements, opt-in live S2-11 | Product/live bindings missing |
| 4 — Lifecycle | All S4-01–11 protocols, time boundaries, quota concurrency barrier, invalidation race, UTC and Buenos Aires weekly boundaries | Product bindings missing |
| 5 — Demo | S3-03–07 API protocols and S3-01–08 browser observation contracts | Browser adapter/tooling/routes and deployed journey unavailable |
| 6 — Reporting | Calibration/contracts/agent/browser/live/release scripts, per-run JSON/Markdown, independent coverage registry, provenance validation and redaction | Executed baseline; release correctly rejects blocked requirements |

## Final verification

- `npm run eval:typecheck`: exit 0.
- Product `tsc --noEmit`: exit 0.
- `npm run eval:contracts`: exit 0; 40 calibration tests pass, 24 product-backed tests deliberately skipped during calibration; 29 acceptance results blocked.
- `npm run eval:release`: exit 1 as required; 40 calibration tests pass, 0 fail; 68 acceptance executions blocked, 0 product passes, 0 observed product failures, 0 infrastructure errors.
- Final release report: [summary](results/2026-09-11T04-37-07-749Z-13015/summary.md), [JSON](results/2026-09-11T04-37-07-749Z-13015/results.json).

The 68 executions comprise all 42 plan IDs, five overlapping API/browser cases, one supplemental scorer gate, and two extra repetitions of each of the ten agent scenarios. A blocked repetition is not a successful agent run. Reports remain local and gitignored.

## Remaining prerequisites and limits

Real persistence, ownership, transaction, scheduler, and demo workflows do not exist yet. Their operation bindings must exercise actual backend logic and independently inspect storage. API/browser observation adapters must collect real HTTP/DOM/storage evidence; returning precomputed booleans is not valid acceptance evidence. Browser observation contracts are prepared, but executable Playwright route bindings/configuration remain deferred until UI selection, as the plan allows. No browser or deployed visitor journey was performed and no live screenshots were captured.

No explicit disposable PostgreSQL server was configured, so database grants/mutations were not executed. No deployed live research-loop adapter was configured; a standalone existing Linkup search would not satisfy the saved-finding/follow-up demonstration gate. Credentials were not loaded from `.env.local`.

The scoring formula, weights, and defaults are still unspecified. S1-SCORER deliberately remains blocked until independently calculated formula examples can be added. Synthetic rubric anchors calibrate threshold logic; they do not replace human review of actual semantic output or establish source support by themselves.

Review found and corrected oracle leakage in provider inputs, missing result trace/provenance attachments, and an operation result overriding the independent demo snapshot. Focused tests cover oracle isolation, grader mutations and release/report gates. The final review agent hit its usage limit after reporting these findings; no claim of a completed independent whole-change approval is made.

## Decisions

- Kept work in the existing non-main workspace and left it uncommitted to preserve the active IDE context and existing edits. If a separate worktree is preferred, these changes need moving.
- Left missing scoring policy and product/UI/deployment capabilities blocked instead of designing or implementing the product. Release cannot pass until that work and its independent verification are complete.
