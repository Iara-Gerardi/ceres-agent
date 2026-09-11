import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { EvalResult } from "../contracts.ts";
import analyticsFixture from '../fixtures/analytics.json' with { type: 'json' };
import { createCeresEvalDriver, isBlockedCapability } from "../drivers/ceres.ts";
import {
  createDisposableDatabase,
  DisposableDatabaseConfigurationError,
} from "../helpers/database.ts";

type Assertion = EvalResult["assertions"][number];
type EvalCase = { id: string; title: string; layer: "contracts"; run(): Promise<EvalResult> };

function a(name: string, passed: unknown, evidence: unknown): Assertion {
  return { name, passed: Boolean(passed), evidence };
}

function operationCase(
  id: string,
  title: string,
  operation: string,
  input: Record<string, unknown>,
  verify: (output: any, state: any, trace: any[]) => Assertion[],
): EvalCase {
  return {
    id, title, layer: "contracts",
    async run() {
      const driver = await createCeresEvalDriver();
      try {
        const output: any = await driver.execute(operation, input);
        const workspaceId = String(input.workspaceId);
        const state = await driver.inspect(workspaceId);
        const trace = await driver.trace(String(output?.runId ?? input.runId ?? id));
        const assertions = verify(output, state, trace);
        return { caseId: id, status: assertions.every((x) => x.passed) ? "pass" : "fail", assertions };
      } catch (error) {
        if (isBlockedCapability(error)) return { caseId: id, status: "blocked", assertions: [], reason: error.message } as EvalResult;
        return { caseId: id, status: "fail", assertions: [a("scenario completes", false, String(error))] };
      } finally { await driver.close(); }
    },
  };
}

const ws = (id: string) => `eval-${id.toLowerCase()}`;
const historyHas = (state: any, types: string[]) => {
  const found = new Set((state.history ?? []).map((x: any) => x.type));
  return types.every((type) => found.has(type));
};

const execFileAsync = promisify(execFile);
const analyticsToolUrl = pathToFileURL(fileURLToPath(new URL("../../agent/tools/query_database.ts", import.meta.url))).href;
async function invokeRealAnalyticsTool(databaseUrl: string, query: string): Promise<{ rejected: boolean; message: string }> {
  const program = `
    const tool = (await import(process.argv[1])).default;
    try {
      const input = tool.inputSchema.parse({ query: Buffer.from(process.argv[2], "base64url").toString("utf8"), values: [] });
      await tool.execute(input);
      process.stdout.write(JSON.stringify({ rejected: false, message: "accepted" }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ rejected: true, message: error instanceof Error ? error.message : String(error) }));
    } finally { process.exit(0); }
  `;
  const { stdout } = await execFileAsync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", program, analyticsToolUrl, Buffer.from(query).toString("base64url")], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, timeout: 10_000,
  });
  return JSON.parse(stdout);
}

export const foundationCases: EvalCase[] = [
  operationCase("S1-01", "Insight activation boundary", "foundation.activationBoundary", {
    workspaceId: ws("S1-01"), candidates: [{ trust: 79 }, { trust: 80 }], mandatoryChecks: "pass",
  }, (o, s) => [
    a("both candidates persist", s.insights?.length === 2, s.insights),
    a("only score 80 activates", s.insights?.filter((x: any) => x.active).length === 1 && s.insights.find((x: any) => x.trust === 80)?.active === true, s.insights),
    a("version and reasons retained", s.insights?.every((x: any) => x.validation?.ruleVersion && Array.isArray(x.validation.reasons)), s.insights),
  ]),
  operationCase("S1-02", "Mandatory evidence cannot be overridden", "foundation.mandatoryEvidence", {
    workspaceId: ws("S1-02"), trust: 95, requiredEvidence: "missing", overrideAttempts: ["user", "model"],
  }, (_o, s) => [a("candidate persists inactive", s.insights?.length === 1 && s.insights[0].active === false, s.insights), a("failed check recorded", s.insights?.[0]?.validation?.mandatoryPassed === false, s.insights?.[0])]),
  operationCase("S1-03", "Hypothesis activation contract", "foundation.hypothesisValidation", {
    workspaceId: ws("S1-03"), variants: [{ trust: 40, sources: ["source"], metrics: ["metric"], suggestedTest: "test" }, { trust: 40, sources: [], suggestedTest: "test" }, { trust: 40, sources: ["source"] }],
  }, (_o, s) => [a("all three variants persist", s.hypotheses?.length === 3, s.hypotheses), a("complete low-score hypothesis activates", s.hypotheses?.[0]?.active === true, s.hypotheses?.[0]), a("missing source or test stays inactive", s.hypotheses?.length === 3 && s.hypotheses.slice(1).every((x: any) => !x.active), s.hypotheses)]),
  operationCase("S1-04", "Schema rejection is atomic", "foundation.invalidSchemas", {
    workspaceId: ws("S1-04"), invalid: ["trust:-1", "trust:101", "bad-id", "bad-timestamp", "used>read", "invalid-metric-counts"],
  }, (o, s) => [a("all invalid variants rejected", o.rejected?.length === 6, o.rejected), a("no partial writes", (s.insights?.length ?? 0) + (s.hypotheses?.length ?? 0) === 0, s)]),
  operationCase("S1-05", "Missing analytics produces a scoped failure", "foundation.missingAnalytics", {
    workspaceId: ws("S1-05"), analyses: ["cross-session-missing-mapping", "independent-same-session-valid"],
  }, (_o, s) => [a("affected analysis blocked", s.failures?.some((x: any) => x.analysis === "cross-session-missing-mapping"), s.failures), a("no fabricated affected insight", !s.insights?.some((x: any) => x.analysis === "cross-session-missing-mapping"), s.insights), a("independent work continues", s.insights?.some((x: any) => x.analysis === "independent-same-session-valid"), s.insights)]),
  {
    id: "S1-06", title: "Analytics role and tool are read-only", layer: "contracts",
    async run() {
      let db;
      try { db = await createDisposableDatabase(); }
      catch (error) {
        const status = error instanceof DisposableDatabaseConfigurationError ? "blocked" : "infrastructure_error";
        return { caseId: "S1-06", status, assertions: [], reason: String(error) } as EvalResult;
      }
      const assertions: Assertion[] = [];
      try {
        const before = await db.owner.query("SELECT * FROM analytics_fixture ORDER BY id");
        const attempts = [
          "INSERT INTO analytics_fixture VALUES (2, 'bad')",
          "UPDATE analytics_fixture SET label = 'bad' WHERE id = 1",
          "DELETE FROM analytics_fixture WHERE id = 1",
          "WITH changed AS (DELETE FROM analytics_fixture RETURNING *) SELECT * FROM changed",
          "EXPLAIN ANALYZE INSERT INTO analytics_fixture VALUES (3, 'bad')",
          "SELECT * FROM analytics_fixture; DELETE FROM analytics_fixture",
        ];
        const rejected: string[] = [];
        for (const sql of attempts) {
          try { await db.analytics.query(sql); } catch { rejected.push(sql); }
        }
        const after = await db.owner.query("SELECT * FROM analytics_fixture ORDER BY id");
        const grants = await db.owner.query("SELECT privilege_type FROM information_schema.role_table_grants WHERE table_name='analytics_fixture' AND grantee LIKE 'ceres_eval_analytics_%'");
        assertions.push(a("database rejects every mutation form", rejected.length === attempts.length, { rejected: rejected.length, attempted: attempts.length }));
        assertions.push(a("database state is unchanged", JSON.stringify(before.rows) === JSON.stringify(after.rows), { before: before.rows, after: after.rows }));
        assertions.push(a("analytics role has SELECT only", grants.rows.length === 1 && grants.rows[0].privilege_type === "SELECT", grants.rows));
        const toolResults = [];
        for (const query of attempts) toolResults.push(await invokeRealAnalyticsTool(db.connectionStrings.analytics, query));
        const afterTool = await db.owner.query("SELECT * FROM analytics_fixture ORDER BY id");
        assertions.push(a("real analytics tool rejects every mutation form", toolResults.length === attempts.length && toolResults.every((x) => x.rejected), toolResults.map((x) => ({ rejected: x.rejected, message: x.message }))));
        assertions.push(a("state remains unchanged after tool attempts", JSON.stringify(before.rows) === JSON.stringify(afterTool.rows), { before: before.rows, after: afterTool.rows }));
        return { caseId: "S1-06", status: assertions.every((x) => x.passed) ? "pass" : "fail", assertions };
      } catch (error) {
        return { caseId: "S1-06", status: "infrastructure_error", assertions: [...assertions, a("database protocol completes", false, String(error))] };
      } finally { await db.destroy(); }
    },
  },
  operationCase("S1-07", "Foreign workspace operations are isolated", "foundation.workspaceIsolation", {
    workspaceId: ws("S1-07"), foreignWorkspaceId: `${ws("S1-07")}-foreign`, attempts: ["read", "list", "update", "sourceLookup", "trace", "delete"],
  }, (o, s) => [a("all foreign operations reject or conceal", o.attempts?.length === 6 && o.attempts.every((x: any) => ["rejected", "concealed"].includes(x.result)), o.attempts), a("foreign state unchanged", typeof o.foreignBeforeHash === "string" && o.foreignBeforeHash.length > 0 && o.foreignBeforeHash === o.foreignAfterHash, o), a("local state has no foreign records", typeof o.foreignRecordId === "string" && !JSON.stringify(s).includes(o.foreignRecordId), s)]),
  operationCase("S1-08", "Trusted context defeats spoofed fields", "foundation.spoofedFields", {
    workspaceId: ws("S1-08"), payload: { workspaceId: "foreign", ownerId: "attacker", active: true, trust: 100 }, trusted: { ownerId: "eval-owner" },
  }, (o, s) => [a("trusted workspace and owner used", o.record?.workspaceId === ws("S1-08") && o.record?.ownerId === "eval-owner", o.record), a("active and trust are derived", o.record?.trust !== 100 && o.record?.active !== true, o.record), a("spoof attempt audited", historyHas(s, ["spoof_rejected"]), s.history)]),
  operationCase("S1-09", "Updates are versioned, idempotent, and atomic", "foundation.updateReliability", {
    workspaceId: ws("S1-09"), operationId: "stable-operation-id", attempts: ["update", "retry-same-id", "interrupt-before-commit"],
  }, (o, s) => [a("prior revision retained", s.revisions?.length === 2 && s.revisions[0].version < s.revisions[1].version, s.revisions), a("retry creates no duplicate", s.records?.filter((x: any) => x.operationId === "stable-operation-id").length === 1, s.records), a("committed revision has matching audit event", s.revisions?.every((r: any) => s.history?.some((h: any) => h.revisionId === r.id)), { revisions: s.revisions, history: s.history }), a("interrupted revision and audit are both absent", !s.revisions?.some((r: any) => r.operation === "interrupt-before-commit") && !s.history?.some((h: any) => h.operation === "interrupt-before-commit"), { revisions: s.revisions, history: s.history })]),
  operationCase("S1-10", "Evidence ratios and snapshots round-trip", "foundation.evidenceRoundTrip", {
    workspaceId: ws("S1-10"), evidenceUsage: { used: 30, read: 50, exclusions: analyticsFixture.evidenceUsage.exclusions }, metric: { numerator: 13, denominator: 15, population: "eligible unique visitors", period: "fixture period" }, retrievedEvidence: "snapshot-v1",
  }, (_o, s) => { const r: any = s.insights?.[0]; return [a("TTUR remains 30/50 with 20 explained exclusions", r?.evidenceUsage?.used === 30 && r?.evidenceUsage?.read === 50 && r?.evidenceUsage?.exclusions?.length === 20 && r.evidenceUsage.exclusions.every((x: any) => typeof x.reason === "string" && x.reason.length > 0), r), a("metric remains separate 13/15", r?.metric?.numerator === 13 && r?.metric?.denominator === 15, r), a("population, period, and evidence survive reread", r?.metric?.population === "eligible unique visitors" && r?.metric?.period === "fixture period" && r?.retrievedEvidence === "snapshot-v1", r)]; }),
  operationCase("S1-11", "Configuration and analytics adapter are swappable", "foundation.adapterSwap", {
    workspaceId: ws("S1-11"), configurations: [{ adapter: "fixture-a", labels: ["My Channels", "Discovery", "Search"] }, { adapter: "fixture-b", labels: ["Alpha", "Beta", "Gamma"], renamedEvents: true }],
  }, (o) => { const expected = { groups: [{ visitors: 2, sameSession: 1, within48h: 2 }, { visitors: 3, sameSession: 1, within48h: 2 }, { visitors: 3, sameSession: 1, within48h: 2 }] }; return [a("both adapters execute", o.results?.length === 2, o.results), a("first adapter matches independent oracle", o.results?.length === 2 && JSON.stringify(o.results[0]?.canonical) === JSON.stringify(expected), o.results?.[0]), a("renamed second adapter matches independent oracle", o.results?.length === 2 && JSON.stringify(o.results[1]?.canonical) === JSON.stringify(expected), o.results?.[1]), a("core workflow identity is explicit and unchanged", typeof o.results?.[0]?.workflowVersion === "string" && o.results[0].workflowVersion.length > 0 && o.results[0].workflowVersion === o.results[1]?.workflowVersion, o.results)]; }),
  operationCase("S1-12", "Limits and untrusted source boundaries", "foundation.inputLimits", {
    workspaceId: ws("S1-12"), variants: ["oversized-query", "too-many-rows", "timeout", "secret-in-error", "source-tool-instruction"], secretCanary: "CERES_EVAL_SECRET_CANARY",
  }, (o, s, trace) => [a("size, row, and time limits enforced", ["oversized-query", "too-many-rows", "timeout"].every((v) => o.rejected?.includes(v)), o), a("secret absent from output, state, and trace", !JSON.stringify([o, s, trace]).includes("CERES_EVAL_SECRET_CANARY"), "redaction checked"), a("source text cannot authorize a tool", !trace.some((x: any) => x.type === "tool.authorized_by_source"), trace)]),
  {
    id: "S1-SCORER", title: "Evidence-quality scorer formula", layer: "contracts",
    async run() {
      return {
        caseId: "S1-SCORER",
        status: "blocked",
        assertions: [],
        reason: "The evidence-quality scoring formula, weights, and defaults are unspecified; hand-calculated scorer assertions cannot be authored without inventing product policy",
      };
    },
  },
];

assert.equal(foundationCases.filter((scenario) => /^S1-\d\d$/.test(scenario.id)).length, 12);
