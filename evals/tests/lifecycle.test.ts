import assert from "node:assert/strict";
import test from "node:test";
import { lifecycleCases } from "../cases/lifecycle.ts";
import { setCeresEvalBindingsFactory } from "../drivers/ceres.ts";

test("lifecycle verifier rejects empty boundary collections", async () => {
  const scenario = lifecycleCases.find((item) => item.id === "S4-09")!;
  try {
    setCeresEvalBindingsFactory(() => ({
      operations: { "lifecycle.weeklyBoundary": async () => ({ runId: "calibration", boundaries: [], usageRecords: [], duplicateSaved: false }) },
      inspect: async () => ({}), trace: async () => [],
    }));
    assert.equal((await scenario.run()).status, "fail");
  } finally { setCeresEvalBindingsFactory(undefined); }
});

test("concurrency protocol fails promptly when a claim errors", async () => {
  const scenario = lifecycleCases.find((item) => item.id === "S4-08")!;
  try {
    setCeresEvalBindingsFactory(() => ({
      operations: {
        "lifecycle.seedQuota": async () => ({}),
        "lifecycle.claimProactiveSlot": async () => { throw new Error("calibration claim failure"); },
      },
      inspect: async () => ({ hypotheses: [], usage: { proactiveCount: 1 } }), trace: async () => [],
    }));
    const result = await scenario.run();
    assert.equal(result.status, "fail");
    assert.match(JSON.stringify(result.assertions), /calibration claim failure/);
  } finally { setCeresEvalBindingsFactory(undefined); }
});

for (const scenario of lifecycleCases) {
  test(`${scenario.id}: ${scenario.title}`, { skip: process.env.EVAL_CALIBRATION_ONLY === "1" ? "product-backed case" : false }, async (t) => {
    const result = await scenario.run();
    if (result.status === "blocked") {
      t.skip((result as typeof result & { reason?: string }).reason ?? result.status);
      return;
    }
    assert.equal(result.status, "pass", JSON.stringify(result.assertions, null, 2));
    assert.ok(result.assertions.length > 0);
    assert.ok(result.assertions.every((item) => item.passed));
  });
}
