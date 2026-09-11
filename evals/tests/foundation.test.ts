import assert from "node:assert/strict";
import test from "node:test";
import { foundationCases } from "../cases/foundation.ts";
import { setCeresEvalBindingsFactory } from "../drivers/ceres.ts";

test("foundation verifier accepts complete state and rejects an empty snapshot", async () => {
  const scenario = foundationCases.find((item) => item.id === "S1-03")!;
  try {
    setCeresEvalBindingsFactory(() => ({
      operations: { "foundation.hypothesisValidation": async () => ({ runId: "calibration" }) },
      inspect: async () => ({ hypotheses: [{ active: true }, { active: false }, { active: false }] }),
      trace: async () => [],
    }));
    assert.equal((await scenario.run()).status, "pass");
    setCeresEvalBindingsFactory(() => ({
      operations: { "foundation.hypothesisValidation": async () => ({ runId: "calibration" }) },
      inspect: async () => ({}), trace: async () => [],
    }));
    assert.equal((await scenario.run()).status, "fail");
  } finally { setCeresEvalBindingsFactory(undefined); }
});

for (const scenario of foundationCases) {
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
