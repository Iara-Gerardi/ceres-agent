import assert from "node:assert/strict";
import test from "node:test";
import type { TraceEvent } from "../contracts.ts";
import { evaluateDemoTrace } from "../cases/demo.ts";
import { evaluateBrowserObservation } from "../browser/demo.spec.ts";

function e(sequence: number, type: string, payload: Record<string, unknown> = {}): TraceEvent {
  return { sequence, type, payload, runId: "r", workspaceId: "w", at: "2026-09-10T12:00:00Z" };
}

test("S3-03 fails when even one direct foreign mutation changes state", () => {
  const actions = ["read", "list", "mutate", "delete"];
  const good = actions.map((action, index) => e(index + 1, "isolation.probe", { action, status: 404, changed: false }));
  assert.equal(evaluateDemoTrace("S3-03", good, { workspaceRecordsIndependent: true, usageIndependent: true }).status, "pass");
  const bad = good.map((item) => item.payload.action === "mutate" ? e(item.sequence, item.type, { action: "mutate", status: 200, changed: true }) : item);
  assert.equal(evaluateDemoTrace("S3-03", bad, { workspaceRecordsIndependent: true, usageIndependent: true }).status, "fail");
});

test("S3-06 rejects writes after the exact expiry event", () => {
  const good = [e(1, "provider.attempt"), e(2, "workspace.expired"), e(3, "run.completion.after_expiry", { resurrected: false })];
  assert.equal(evaluateDemoTrace("S3-06", good).status, "pass");
  assert.equal(evaluateDemoTrace("S3-06", [...good.slice(0, 2), e(3, "record.persisted"), e(4, "run.completion.after_expiry", { resurrected: false })]).status, "fail");
});

test("browser evidence journey requires stored-value agreement, not mere visibility", () => {
  const evidence = { countsVisible: true, validationVisible: true, sourcesVisible: true, followUpProgressionVisible: true, suggestedTestVisible: true, uncertaintyVisible: true, historyVisible: true, matchesStoredValues: true };
  assert.equal(evaluateBrowserObservation("S3-02", { evidence }).status, "pass");
  assert.equal(evaluateBrowserObservation("S3-02", { evidence: { ...evidence, matchesStoredValues: false } }).status, "fail");
});
