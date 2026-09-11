import type { AssertionResult, EvalResult, TraceEvent } from "../contracts.ts";
import { BlockedCapabilityError, createCeresEvalDriver } from "../drivers/ceres.ts";

type DemoEnvelope = { workspaceId?: string; peerWorkspaceId?: string; runId?: string; state?: Record<string, unknown> };

function check(name: string, passed: boolean, evidence: unknown): AssertionResult {
  return { name, passed, evidence };
}

function byType(trace: TraceEvent[], type: string): TraceEvent[] {
  return trace.filter((event) => event.type === type);
}

export function evaluateDemoTrace(caseId: string, trace: TraceEvent[], state: Record<string, unknown> = {}): EvalResult {
  const assertions: AssertionResult[] = [];
  if (caseId === "S3-03") {
    const probes = byType(trace, "isolation.probe").map(({ payload }) => payload);
    assertions.push(check("foreign reads and mutations are rejected without state change", ["read", "list", "mutate", "delete"].every((action) => probes.some((p) => p.action === action && (p.status === 403 || p.status === 404) && p.changed === false)), probes));
    assertions.push(check("visitor workspaces retain independent records", state.workspaceRecordsIndependent === true && state.usageIndependent === true, state));
  }
  if (caseId === "S3-04") {
    const changes = byType(trace, "record.status.changed").map(({ payload }) => payload);
    const history = byType(trace, "record.history.persisted").map(({ payload }) => payload);
    const hardDelete = byType(trace, "record.hard_delete.denied").at(-1)?.payload;
    assertions.push(check("invalidate, validated restore, and soft-delete persist with history", ["invalidated", "restored", "soft_deleted"].every((status) => changes.some((p) => p.status === status)) && history.length >= 3 && changes.find((p) => p.status === "restored")?.validationPassed === true, { changes, history }));
    assertions.push(check("visitor cannot permanently delete configured-project records", hardDelete?.actor === "visitor" && hardDelete?.configuredProject === true, hardDelete));
  }
  if (caseId === "S3-05") {
    const access = byType(trace, "workspace.access").map(({ payload }) => payload);
    const cleanup = byType(trace, "workspace.cleanup.completed").at(-1)?.payload;
    assertions.push(check("workspace works before expiry and rejects at the boundary", access.some((p) => p.relativeToExpiry === "before" && p.allowed === true) && access.some((p) => p.relativeToExpiry === "at" && p.allowed === false), access));
    assertions.push(check("cleanup removes workspace-owned data while preserving shared/configured data", cleanup?.workspaceOwnedRemaining === 0 && cleanup?.sharedFixturePreserved === true && cleanup?.configuredProjectPreserved === true, cleanup));
  }
  if (caseId === "S3-06") {
    const expiredAt = byType(trace, "workspace.expired").at(0)?.sequence ?? -1;
    const violations = trace.filter((event) => event.sequence > expiredAt && ["provider.attempt", "record.persisted", "research.finding.persisted"].includes(event.type));
    const completion = byType(trace, "run.completion.after_expiry").at(-1)?.payload;
    assertions.push(check("a run crossing expiry makes no provider calls or writes and cannot resurrect state", expiredAt >= 0 && violations.length === 0 && completion?.resurrected === false, { expiredAt, violations, completion }));
  }
  if (caseId === "S3-07") {
    const limits = byType(trace, "usage.limit.enforced").map(({ payload }) => payload);
    const failure = byType(trace, "run.failure.presented").at(-1)?.payload;
    assertions.push(check("direct API usage is bounded", limits.some((p) => p.via === "direct_api" && p.allowed === false && (p.status === 429 || p.status === 403)), limits));
    assertions.push(check("failures are actionable and terminal", typeof failure?.message === "string" && failure.message.length > 0 && failure.loading === false && failure.inventedResult !== true, failure));
  }
  const failed = assertions.filter((item) => !item.passed);
  return { caseId, status: failed.length ? "fail" : "pass", assertions, ...(failed.length ? { reason: `Failed: ${failed.map((a) => a.name).join(", ")}` } : {}) };
}

const definitions = [
  ["S3-03", "Two isolated visitor contexts"],
  ["S3-04", "Record lifecycle and deletion permissions"],
  ["S3-05", "Expiry boundary and cleanup"],
  ["S3-06", "Run crossing workspace expiry"],
  ["S3-07", "Backend limits and visible failures"],
] as const;

async function runDemoCase(id: string): Promise<EvalResult> {
  const driver = await createCeresEvalDriver();
  try {
    const result = await driver.execute("demo.runApiScenario", { caseId: id, clockMode: "injected", workspaceCount: id === "S3-03" ? 2 : 1 }) as DemoEnvelope;
    if (!result.runId || !result.workspaceId) return { caseId: id, status: "fail", reason: "Driver did not return inspectable run/workspace IDs", assertions: [] };
    const [trace, state] = await Promise.all([driver.trace(result.runId), driver.inspect(result.workspaceId)]);
    return { ...evaluateDemoTrace(id, trace, state), trace };
  } catch (error) {
    if (error instanceof BlockedCapabilityError) return { caseId: id, status: "blocked", reason: error.message, assertions: [] };
    return { caseId: id, status: "infrastructure_error", reason: error instanceof Error ? error.message : String(error), assertions: [] };
  } finally {
    await driver.close();
  }
}

export const demoCases = definitions.map(([id, title]) => ({ id, title, layer: "contracts" as const, run: () => runDemoCase(id) }));
