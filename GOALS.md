# Ceres Product Goals

## Vision

Ceres is a general product-management agent built on top of PostHog. It turns product and behavioral data into prioritized, evidence-based actions, helps execute those actions, and measures their impact.

The product should close the loop from observation to decision to action:

1. Understand what is happening in the product.
2. Identify opportunities, problems, and likely explanations.
3. Recommend a concrete next action with a clear rationale.
4. Apply the authorized change or create a handoff when execution is unavailable.
5. Use an experiment and its results to decide what to do next.

## Primary objective

Build an agent that can use live PostHog data to:

- Answer product questions with traceable metrics and appropriate context.
- Analyze user behavior with PostHog Product Analytics, including trends, funnels, paths, retention, cohorts, lifecycle, and related event or property breakdowns.
- Detect meaningful opportunities and prioritize them by expected impact, confidence, effort, and risk.
- Turn analysis into actionables that name the target, proposed change, expected outcome, success metric, guardrails, assumptions, and next step.
- Use PostHog Experiments to turn hypotheses into measurable tests and interpret their results.
- Take scoped product actions when an approved execution path is available, without claiming that an action succeeded unless the external system confirms it.

## MVP

The MVP focuses on improving a landing page. Its end-to-end workflow is:

1. Read the configured PostHog project's schema and relevant live product data.
2. Analyze the landing-page journey and establish a trustworthy baseline with Product Analytics.
3. Identify and prioritize a specific improvement opportunity.
4. Produce a testable hypothesis and a concrete landing-page change.
5. Apply the authorized landing-page change through an execution mechanism that is still to be defined.
6. Create or associate a PostHog experiment with the change, including its audience, primary metric, guardrails, and success criteria.
7. Read the experiment results and recommend whether to ship, iterate, revert, or investigate further.
8. Persist an inspectable record of the data, reasoning, decision, action, and outcome.

The landing-page execution mechanism is an explicit open product and technical decision. Candidate approaches should be evaluated for safe previews, approval controls, rollback, reliable change confirmation, and compatibility with PostHog experiments.

## Role of PostHog

PostHog is the central product-data and experimentation platform for Ceres, not an optional side channel. The integration should progressively support:

- Schema and event discovery.
- Product Analytics queries and saved analytical context.
- Experiment creation or association, configuration, status, and result analysis.
- Cohorts and feature flags when needed for experiment targeting and rollout.
- Clear project scoping, permissions, and auditability for both reads and writes.

PostHog data must remain distinct from mock or sample data. If live data is unavailable or a request cannot be answered from the available instrumentation, Ceres must say so explicitly.

## Role of external research

Linkup is a supporting capability, not the center of the product or a mandatory step. Ceres should call Linkup only when external information is necessary to answer a material question that PostHog data, product context, or direct inspection cannot resolve.

Appropriate uses include validating external claims, researching a market or competitor, and gathering current context that could change a recommendation. Linkup should be skipped when internal product data is sufficient. External research must never substitute for missing instrumentation or be presented as proof of internal user behavior.

## Quality and safety requirements

- Never invent events, metrics, page content, experiment results, actions, or citations.
- Show the metric definition, time range, filters, comparison, and sample-size limitations behind important conclusions.
- Distinguish observations from hypotheses and causal conclusions.
- Make every recommendation actionable and tie it to a measurable product outcome.
- Preserve assumptions, uncertainties, contradictory evidence, and missing instrumentation.
- Require appropriately scoped authorization for external changes and PostHog writes.
- Prefer preview and approval before changing a user-facing landing page, and retain a rollback path.
- Record tool failures without leaking credentials or sensitive provider details.
- Do not claim that a page changed, an experiment started, or a result improved unless the relevant system confirms it.

## MVP success criteria

- A user can connect a real PostHog project and ask a product question without relying on the built-in synthetic dataset.
- Ceres uses Product Analytics to produce a reproducible finding from the landing-page journey.
- The result contains a prioritized recommendation with a concrete change, primary metric, guardrails, assumptions, and expected impact.
- Ceres can apply an authorized landing-page change through the selected execution mechanism and verify the resulting state.
- The change is connected to a valid PostHog experiment that Ceres can inspect and evaluate.
- Ceres recommends a next action from the experiment outcome without overstating causality or certainty.
- Linkup is not called in workflows where PostHog and product context are sufficient.
- The saved record trail makes the analysis, recommendation, approval, execution, and outcome easy to inspect.
- Automated tests cover analytics correctness, permission boundaries, action confirmation, experiment integration, persistence, and failure handling.

## Beyond the MVP

After validating the landing-page loop, expand Ceres to additional product surfaces and recurring product-management workflows, including proactive opportunity discovery, instrumentation recommendations, roadmap support, continuous experiment monitoring, multi-project administration, workspaces, tenant isolation, and additional execution integrations.
