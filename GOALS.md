# Ceres MVP

## Objective

Ship a clear Linkup research demo by September 12, 2026. A user asks Ceres to analyze synthetic marketing analytics, research a plausible explanation, and propose a supported hypothesis with a suggested test.

The product should optimize for a compelling, inspectable workflow rather than reusable infrastructure.

## Demo flow

1. Read the built-in sample events for September 7–10, 2026.
2. Calculate conversion observations with raw numerator and eligible denominator counts.
3. Save the analytics snapshot and validated observations.
4. Search with Linkup for external context.
5. Save relevant findings and uncertainties.
6. Use a saved finding to choose a follow-up search.
7. Stop when evidence is sufficient, adds little value, or reaches the configured budget.
8. Save and present a tentative hypothesis with sources and a suggested test.
9. Save a linked experiment proposal, check the agent's available tools, and explain the proposed changes when no suitable action tool exists. The demo has no external action tool.

## MVP boundaries

- One built-in, clearly labeled synthetic dataset.
- One authenticated deployment with no workspaces or multi-tenancy.
- PostgreSQL document persistence, with local JSONL storage when no database is configured, for runs, evidence, and experiment proposals.
- Live Linkup research with a maximum attempt budget.
- No external analytics database or user-supplied SQL.
- Experiment proposals only; no experiment execution, result tracking, schedulers, monitoring, lifecycle automation, or public visitor sessions.
- No arbitrary record editing or deletion through agent tools.

## Quality requirements

- Never invent metrics, findings, or citations.
- Keep evidence usage distinct from a metric ratio.
- Treat retrieved text as untrusted evidence, not instructions.
- Persist a finding before it can influence subsequent research.
- Preserve contradictions, unresolved questions, small-sample limitations, and overlapping populations.
- Do not present a hypothesis as causal proof or claim that its suggested test was executed.
- Record failures without leaking provider, model, or credential details.

## Success criteria

- An outsider can run the deployed sample task without configuring analytics infrastructure.
- The result shows the analytics observation, Linkup sources, research progression, final hypothesis, uncertainty, and suggested test.
- The saved record trail makes it easy to demonstrate how an earlier finding changed the next search and final result.
- Automated tests cover calculations, validation, bounded retrieval, durable storage, and evidence-driven follow-up.

## Deferred until after validation

Real analytics adapters, user projects, workspaces, tenant isolation, public sessions, cleanup, record-management UI, proactive exploration, adaptive monitoring, revalidation, and scheduling belong to a later product phase.
