import type { AssertionResult, EvalResult, TraceEvent } from "../contracts.ts";

type LiveAdapter = {
  start(input: { task: string; maximumProviderAttempts: number }): Promise<{ runId: string; workspaceId: string }>;
  inspect(workspaceId: string): Promise<Record<string, unknown>>;
  trace(runId: string): Promise<TraceEvent[]>;
  close?(): Promise<void>;
};
type LiveModule = { createLiveAdapter?: () => LiveAdapter | Promise<LiveAdapter>; default?: LiveAdapter | (() => LiveAdapter | Promise<LiveAdapter>) };

function check(name: string, passed: boolean, evidence: unknown): AssertionResult { return { name, passed, evidence }; }

export function evaluateLiveTrace(trace: TraceEvent[], state: Record<string, unknown>): EvalResult {
  const attempts = trace.filter((e) => e.type === "provider.attempt");
  const findings = trace.filter((e) => e.type === "research.finding.persisted");
  const persistedAt = new Map(findings.map((e) => [e.payload.findingId, e.sequence]));
  const followups = trace.filter((e) => e.type === "research.follow_up");
  const linked = trace.filter((e) => e.type === "hypothesis.persisted").at(-1)?.payload;
  const assertions = [
    check("real provider usage is explicit and bounded", attempts.length >= 2 && attempts.length <= 3 && attempts.every((e) => e.payload.provider === "linkup" && e.payload.mock !== true), { attempts: attempts.length }),
    check("durable findings precede an evidence-dependent follow-up", findings.length > 0 && followups.length > 0 && followups.every((event) => Array.isArray(event.payload.basedOnFindingIds) && event.payload.basedOnFindingIds.length > 0 && event.payload.basedOnFindingIds.every((id: unknown) => typeof id === "string" && (persistedAt.get(id) ?? Infinity) < event.sequence)), { findings: findings.map((e) => e.payload.findingId), followups: followups.map((e) => e.payload) }),
    check("final hypothesis links stored findings and is visible to the visitor", Array.isArray(linked?.sourceFindingIds) && linked.sourceFindingIds.length > 0 && linked.sourceFindingIds.every((id: unknown) => persistedAt.has(id)) && state.visitorCanInspectTrace === true && state.visitorCanInspectSources === true && state.hypothesisId === linked?.hypothesisId, { linked, state }),
    check("live run records actual model, reasoning, and tool limit", typeof state.model === "string" && state.model.length > 0 && typeof state.reasoning === "string" && state.reasoning.length > 0 && state.maximumProviderAttempts === 3, { model: state.model, reasoning: state.reasoning, maximumProviderAttempts: state.maximumProviderAttempts }),
  ];
  const failed = assertions.filter((a) => !a.passed);
  return { caseId: "S2-11", status: failed.length ? "fail" : "pass", assertions, ...(failed.length ? { reason: `Failed: ${failed.map((a) => a.name).join(", ")}` } : {}) };
}

async function loadAdapter(): Promise<LiveAdapter | undefined> {
  const modulePath = process.env.EVAL_LIVE_DRIVER_MODULE;
  if (!modulePath) return undefined;
  const loaded = await import(modulePath) as LiveModule;
  const candidate = loaded.createLiveAdapter ?? loaded.default;
  return typeof candidate === "function" ? await candidate() : candidate;
}

async function runLive(): Promise<EvalResult> {
  if (process.env.EVAL_LIVE_LINKUP !== "1") return { caseId: "S2-11", status: "blocked", reason: "Live Linkup evaluation is opt-in; set EVAL_LIVE_LINKUP=1", assertions: [] };
  if (!process.env.LINKUP_API_KEY) return { caseId: "S2-11", status: "blocked", reason: "LINKUP_API_KEY is required in the environment", assertions: [] };
  let adapter: LiveAdapter | undefined;
  try {
    adapter = await loadAdapter();
    if (!adapter) return { caseId: "S2-11", status: "blocked", reason: "EVAL_LIVE_DRIVER_MODULE must bind the deployed visitor workflow; mocks are not accepted", assertions: [] };
    const started = await adapter.start({ task: "Use the deployed sample analytics to identify a conversion weakness, research a real information gap, save findings, make an evidence-driven follow-up, and propose a supported hypothesis with a suggested test.", maximumProviderAttempts: 3 });
    const [trace, state] = await Promise.all([adapter.trace(started.runId), adapter.inspect(started.workspaceId)]);
    if (trace.some((event) => event.runId !== started.runId || event.workspaceId !== started.workspaceId)) return { caseId: "S2-11", status: "fail", reason: "Live trace contains foreign run/workspace events", assertions: [] };
    const metadata = trace.find(event => event.type === 'run.metadata')?.payload ?? {};
    return { ...evaluateLiveTrace(trace, state), trace,
      metadata: { ...metadata, providerAttempts: trace.filter(event => event.type === 'provider.attempt').length } };
  } catch (error) {
    return { caseId: "S2-11", status: "infrastructure_error", reason: error instanceof Error ? error.message : String(error), assertions: [] };
  } finally {
    await adapter?.close?.();
  }
}

export const liveCases = [{ id: "S2-11", title: "Real deployed Linkup research loop", layer: "live" as const, run: runLive }];
