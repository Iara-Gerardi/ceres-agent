# Ceres MVP definition and roadmap

## Purpose and scope

Ceres is a marketing analysis and strategy agent that reads analytics, produces insights, researches through Linkup, and proposes hypotheses with suggested tests. Its logic must be easy to inspect and change. Evidence, validation results, workflow decisions, and record history make outcomes explainable and debuggable.

This is a broad, reusable product definition. Project-specific events, metrics, and parameters belong in removable configuration. The MVP serves one configured project plus isolated public demo workspaces. Experiments and strategies are excluded as managed entities and required data sources. Ceres proposes tests; humans design and execute them.

## Hackathon objective

Target: **Deep Research — Linkup**. Deadline: **September 12, 2026, at 23:59** PDT (september 13 at 4 AM in local time).

The organizer's track description supplied by the user requires a deployed product that combines stored data with web information, uses Linkup to search and retrieve, stores findings, and uses those findings to decide what to investigate next. The demo must show sources, follow-up searches, and how findings affect the result. Shipping, usefulness, research quality, and essential Linkup integration guide priorities.

Example demo task: analyze a conversion weakness, research possible explanations, and propose a supported hypothesis with a suggested test. Analytics establish the observation; external research informs the explanation or action.

## Operating modes

- **Requested analysis:** answer a user's question using configured analytics definitions and appropriate research.
- **Proactive exploration:** explore data and generate insights and hypotheses when project activity warrants it.
- **Adaptive monitoring:** autonomously adjust exploration frequency within project-configured limits, recording evidence and reasons. Lightweight activity checks detect changes between full analyses.
- **Proactive hypothesis cap:** configurable weekly limit per project. Newly saved proactive hypotheses count even if later invalidated. Explicit user requests can exceed this cap. Check existing hypotheses to avoid duplicates.

## Insights

An insight is a concise analytics-supported observation scoped to a population and period. It includes evidence and avoids unsupported causal claims.

- Save every candidate, including failed candidates.
- `trust` is a 0–100 evidence-quality score, not a probability of truth.
- Activate only when mandatory validation passes and trust is at least 80.
- Failed candidates remain inactive with check results and rejection reasons.
- Missing required data stops the affected analysis and creates a failure record. Do not invent an insight to fill a record; any candidates already produced remain inactive.
- Only active, non-expired, non-deleted insights may serve as current premises for further reasoning.

## Hypotheses

A hypothesis is a tentative claim derived from analytics, active insights, and/or research findings.

- Require supporting source references, relevant metrics, and a short `suggested_test` describing an action and the outcome to observe.
- Structural validation and traceable support are required for activation; there is no 80-point minimum.
- Display evidence quality and uncertainty. Hypotheses remain tentative when used in subsequent work.
- Inconclusive research can produce an active hypothesis if those requirements hold. Preserve unresolved questions and contradictions.
- Detailed experiment design and execution are outside Ceres's responsibility.

## Research findings and Linkup workflow

Research findings are separate internal evidence records, not automatically insights or hypotheses.

Research happens only within creation or revalidation of an insight or hypothesis. Ceres decides whether it is useful within configurable budgets.

1. Read stored analytics and prior records; identify missing information.
2. Search and retrieve through Linkup.
3. Store relevant findings and source evidence.
4. Assess source support, relevance, uncertainty, and contradictions.
5. Use stored findings to choose follow-up searches or stop.
6. Link research to the final insight or hypothesis and explain its effect.

Stop when evidence is sufficient, further searches add little value, or the configured limit is reached. Save the reason and unresolved questions. Reaching the limit does not itself invalidate a hypothesis. External sources can contextualize project analytics but cannot replace missing project data.

## Validation and evidence

An analysis-validation skill guides checks and evidence collection. Tools enforce required checks and calculate scores using explicit, versioned rules. The model does not assign an unsupported confidence number.

Core checks are mandatory: required data exists, definitions are valid, counts are consistent, and sources are traceable. Project-specific checks and thresholds cover matters such as sample sufficiency, tracking completeness, identity linking, and conversion-window completeness. Project configuration cannot bypass core checks.

Preserve two distinct ratios, including their raw counts:

- **Evidence usage (TTUR):** records used / relevant records read, such as 30/50, with reasons for exclusions or sampling.
- **Metric ratio:** numerator / eligible denominator, such as 13 account creations / 15 unique visitors, with metric, population, and period defined.

A high rate from a small sample must retain that context. Unknown counts remain explicitly unavailable. Aggregate query rows must not be confused with underlying visitors or events.

The scoring formula, weights, and defaults still need implementation design. Preserve each validation's rule version and results so changes do not silently reinterpret historical scores.

## Lifecycle and permissions

Both insights and hypotheses have a TTQ (time to question) deadline. At expiry they become inactive until reassessed, retaining original evidence and history.

- Ceres may revalidate expired records but cannot automatically restore manually invalidated ones.
- Users can invalidate and restore records, subject to validation and expiry requirements.
- Ceres can autonomously soft-delete records in the MVP, recording the reason. Human approval is deferred.
- Soft deletion differs from inactivity: deleted records are excluded from normal use and automatic revalidation.
- Only the owner can permanently delete configured-project records.
- Preserve creation, validation, updates, expiration, revalidation, invalidation, restoration, and soft-deletion history.

| Resource | Ceres access |
| --- | --- |
| Project analytics | Read-only |
| Insights and hypotheses | Read, create, validated update, soft-delete through dedicated tools |
| Research findings and operational history | Scoped reads and persistence |
| Configured-project permanent deletion | Owner-only; unavailable to Ceres |
| Expired demo workspace | Cleanup service may permanently delete |

## Conceptual schema requirements

These extend the original draft; they are not final SQL migrations. Use UUIDv7 IDs, UTC timestamps, explicit workspace ownership, and structured input/output validation.

### Shared insight and hypothesis fields

| Fields | Purpose |
| --- | --- |
| `id`, `workspace_id`, `run_id` | Identity, isolation, originating workflow |
| `created_at`, `updated_at`, `version` | Timestamps and revision |
| `trust`, `validation` | Evidence score, checks, rule version, reasons |
| `key_metrics` | Project-defined metric identifiers |
| `active`, `inactive_reason` | Current usability |
| `review_due_at` | TTQ as an explicit deadline, replacing an integer with unspecified units |
| `deleted_at`, `deletion_reason` | Soft-deletion state |
| `sources`, `metric_observations` | Evidence and contextualized measurements |

An insight adds `insight`. A hypothesis adds `hypothesis`, `category`, `suggested_test`, `uncertainties`, and `generation_mode` (requested or proactive).

### Evidence references and measurements

References retain source type and locator (URL, record revision, research finding, analytics query), retrieval time, relevant returned evidence, query/analysis parameters, population, period, evidence-usage counts where measurable, and exclusions. A mutable URL or rerunnable query alone does not preserve what Ceres actually saw.

Metric observations retain metric identifier, value, unit, numerator and denominator where applicable, population, and time window. Revalidation preserves earlier record revisions and their evidence.

### Research and operational records

Research findings retain workspace/run linkage, research question, search query, source URL/title, retrieval time, supported summary or relevant excerpt, uncertainty, contradictions, and links to prior findings and subsequent investigation decisions.

Operational records retain workflow status, analysis definition, configuration version, validation failures, tool outcomes, research steps, scheduling decisions, usage, and record changes. Store concise decision rationales and evidence trails, not private model reasoning or credentials.

## Modular architecture

1. **Core:** workflows, validation, lifecycle, research orchestration, scheduling, limits, and audit history.
2. **Project configuration:** event mappings, metric definitions, identity-linking definitions, analysis defaults, validation settings, activity signals, cadence limits, research budgets, and hypothesis caps.
3. **Adapters:** analytics providers, Linkup, and storage behind defined interfaces.

Replacing an adapter or removing a project configuration must not require rewriting core workflows. Provider-specific queries stay within adapters or explicit project definitions.

Enforce workspace scope in backend tools, not prompts alone. Validate inputs and outputs, bound queries and research calls, and treat retrieved content as untrusted evidence rather than instructions. Keep credentials server-side.

### Skills and tools

Skills describe analysis planning, validation, insight and hypothesis creation/revalidation, research, and monitoring decisions.

Tools implement scoped analytics reads; retrieval of prior records; structured validation; persistence and lifecycle changes; Linkup search/retrieval; research finding storage; and bounded scheduling updates. Enforcement must hold even if a model omits a skill instruction.

## Interface and public demo

The small interface supports analysis requests and responses; browsing insights and hypotheses; evidence, validation, suggested tests, and history inspection; invalidation, restoration, and permitted deletion; research progression; and run failures and upcoming exploration.

Each public visitor gets an isolated temporary workspace:

- Clearly labeled sample analytics may be shared read-only.
- Generated records, findings, history, changes, and usage limits are isolated.
- Visitors can run real Linkup workflows without bringing credentials.
- Proactive monitoring is disabled; the configured project demonstrates it.
- Workspaces expire after 24 hours and their data can be automatically permanently deleted, an explicit owner-only-deletion exception.
- Backend access checks, budgets, and expiry prevent cross-workspace access and use after expiry.

## Illustrative configuration, not core scope

The playground example compares My Channels, Discovery, and Search against successful account creation. The project supplies event mappings and anonymous-to-account identity definitions.

Conversion windows are configurable, with same-session and 48 hours as defaults for this example. The longer rate includes same-session signups; rates are not added. Preserve eligible unique-visitor counts and follow-up completeness.

Visitors may belong to multiple tab groups. Label overlap and avoid causal attribution. Verify identity linking before cross-session analysis; missing prerequisites block the affected calculation while independently valid analyses may continue.

Tab names and conversion windows are not core constants. Views, likes, interactions, shares, payments, and signups are examples of configurable metrics, not a fixed vocabulary.

## Build roadmap

The full scope above is the target. Prioritize a deployed research loop before automation polish; explicitly disclose unfinished scope at submission.

### 1. Foundation and controlled persistence

- Inspect existing agent, database tools, and Linkup integration.
- Finalize schema contracts, scoring rules, project configuration, and workspace boundaries.
- Implement migrations, scoped tools, history, and sample data.
- Verify analytics writes and cross-workspace access are rejected, and failed candidates persist inactive.

### 2. Complete research-driven task

- Implement requested analysis, validation, and saved insights.
- Implement live Linkup retrieval, stored findings, evidence-driven follow-up searches, and bounded stopping.
- Produce a hypothesis with sources, uncertainty, and suggested test.
- Verify a saved finding influences a subsequent search and the final result.

### 3. Deployed external-user experience

- Build the minimal interface alongside the workflows, starting with submission and evidence inspection.
- Add isolated sessions, usage limits, expiry, and cleanup.
- Deploy and verify an outsider can complete the task without team credentials.
- Complete record management and history views with the agreed deletion permissions.

### 4. Revalidation and proactive operation

- Enforce TTQ and revalidation, respecting manual invalidation and soft deletion.
- Add lightweight monitoring and autonomous cadence adjustment within bounds.
- Enforce proactive weekly caps while allowing explicit requests.
- Expose schedule changes and upcoming exploration.

### 5. Submission verification

- Demonstrate the deployed flow with stored analytics and real Linkup research.
- Show sources, intermediate findings, follow-up searches, and impact on the hypothesis.
- Check missing-data behavior, uncertainty, isolation, budgets, lifecycle, and cleanup.
- Capture demonstration evidence, document limitations, and verify submission requirements and timezone.

## Nice to Have

- Connect a visitor's own PostHog project, with protected credentials and event-mapping setup.
- Additional analytics adapters and broader onboarding.
- Human approval for autonomous soft-deletion proposals.

Multi-project administration and automatic test execution are outside the MVP.

## Remaining implementation decisions

Resolve these before the relevant build milestone; they are not silently settled by this document:

- Evidence-quality scoring formula, check weights, and sample-quality defaults.
- Default TTQ policies and response to changed supporting evidence.
- Research budgets, cadence bounds, activity-check intervals, weekly cap values, and reset timezone.
- Scheduler, final migrations, UI implementation, and reliable cleanup mechanism.
- Exact sample dataset and task that naturally require follow-up research.

Keep these choices explicit and versioned. The playground example must not become an implicit constraint on the reusable core.
