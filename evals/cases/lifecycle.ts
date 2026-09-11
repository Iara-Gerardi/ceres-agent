import assert from "node:assert/strict";
import type { EvalResult } from "../contracts.ts";
import { BlockedCapabilityError, createCeresEvalDriver, isBlockedCapability } from "../drivers/ceres.ts";

type Assertion = EvalResult["assertions"][number];
type EvalCase = { id: string; title: string; layer: "contracts"; run(): Promise<EvalResult> };
const a = (name: string, passed: unknown, evidence: unknown): Assertion => ({ name, passed: Boolean(passed), evidence });
const ws = (id: string) => `eval-${id.toLowerCase()}`;

export class AsyncBarrier {
  private release!: () => void;
  private readonly promise = new Promise<void>((resolve) => { this.release = resolve; });
  private arrivals = 0;
  private readonly parties: number;
  constructor(parties: number) { this.parties = parties; }
  async arriveAndWait(): Promise<void> {
    this.arrivals += 1;
    if (this.arrivals === this.parties) this.release();
    await this.promise;
  }
  releaseAll(): void { this.release(); }
}

function operationCase(id: string, title: string, operation: string, input: Record<string, unknown>, verify: (output: any, state: any, trace: any[]) => Assertion[]): EvalCase {
  return { id, title, layer: "contracts", async run() {
    const driver = await createCeresEvalDriver();
    try {
      const output: any = await driver.execute(operation, input);
      const state = await driver.inspect(String(input.workspaceId));
      const trace = await driver.trace(String(output?.runId ?? id));
      const assertions = verify(output, state, trace);
      return { caseId: id, status: assertions.every((x) => x.passed) ? "pass" : "fail", assertions };
    } catch (error) {
      if (isBlockedCapability(error)) return { caseId: id, status: "blocked", assertions: [], reason: error.message } as EvalResult;
      return { caseId: id, status: "fail", assertions: [a("scenario completes", false, String(error))] };
    } finally { await driver.close(); }
  } };
}

export const lifecycleCases: EvalCase[] = [
  {
    id: "S4-01", title: "TTQ boundaries use the injected clock", layer: "contracts",
    async run() {
      const driver = await createCeresEvalDriver();
      try {
        if (!driver.has("advanceClock")) throw new BlockedCapabilityError("advanceClock");
        const workspaceId = ws("S4-01");
        await driver.execute("lifecycle.seedExpiryRecords", { workspaceId, reviewDueAt: "2026-09-14T00:00:00.000Z", recordTypes: ["insight", "hypothesis"], delayScheduler: true });
        const observations: any[] = [];
        for (const at of ["2026-09-13T23:59:59.999Z", "2026-09-14T00:00:00.000Z", "2026-09-14T00:00:00.001Z"]) {
          await driver.advanceClock(at);
          observations.push(await driver.execute("lifecycle.readCurrentRecords", { workspaceId }));
        }
        const state: any = await driver.inspect(workspaceId);
        const assertions = [a("both types usable immediately before deadline", observations[0]?.records?.length === 2 && observations[0].records.every((x: any) => x.usable), observations[0]), a("both types unusable at deadline", observations[1]?.records?.length === 2 && observations[1].records.every((x: any) => !x.usable), observations[1]), a("both types remain unusable after deadline", observations[2]?.records?.length === 2 && observations[2].records.every((x: any) => !x.usable), observations[2]), a("read path enforces expiry despite delayed scheduler", state.scheduler?.lastRunAt == null, state.scheduler)];
        return { caseId: "S4-01", status: assertions.every((x) => x.passed) ? "pass" : "fail", assertions };
      } catch (error) {
        if (isBlockedCapability(error)) return { caseId: "S4-01", status: "blocked", assertions: [], reason: error.message } as EvalResult;
        return { caseId: "S4-01", status: "fail", assertions: [a("boundary protocol completes", false, String(error))] };
      } finally { await driver.close(); }
    },
  },
  operationCase("S4-02", "Revalidation preserves evidence history", "lifecycle.revalidateVariants", {
    workspaceId: ws("S4-02"), variants: ["passing", "failing", "new-evidence"],
  }, (o, s) => [a("activation follows new validation", o.results?.length === 3 && o.results.find((x: any) => x.variant === "passing")?.active === true && o.results.find((x: any) => x.variant === "failing")?.active === false, o.results), a("new validation and evidence revisions exist", Boolean(s.revisions?.some((x: any) => x.kind === "validation") && s.revisions?.some((x: any) => x.kind === "evidence")), s.revisions), a("original statement and evidence retained", Boolean(s.revisions?.[0]?.statement && s.revisions?.[0]?.evidence), s.revisions)]),
  {
    id: "S4-03", title: "Manual invalidation wins an in-flight revalidation", layer: "contracts",
    async run() {
      const driver = await createCeresEvalDriver();
      const reached = new AsyncBarrier(2);
      const resume = new AsyncBarrier(2);
      try {
        if (!driver.has("lifecycle.pausedRevalidation")) throw new BlockedCapabilityError("lifecycle.pausedRevalidation");
        if (!driver.has("lifecycle.manualInvalidate")) throw new BlockedCapabilityError("lifecycle.manualInvalidate");
        if (!driver.has("lifecycle.softDelete")) throw new BlockedCapabilityError("lifecycle.softDelete");
        const workspaceId = ws("S4-03");
        const inFlight = driver.execute("lifecycle.pausedRevalidation", { workspaceId, recordStates: ["manual-invalidated", "soft-deleted"], reached, resume });
        const inFlightOutcome = inFlight.then(() => ({ ok: true as const }), (error) => ({ ok: false as const, error }));
        const arrival = reached.arriveAndWait().then(() => ({ arrived: true as const }));
        let timeoutHandle: NodeJS.Timeout | undefined;
        const timeout = new Promise<{ timeout: true }>((resolve) => { timeoutHandle = setTimeout(() => resolve({ timeout: true }), 2_000); });
        const first = await Promise.race([arrival, inFlightOutcome, timeout]);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if ("ok" in first && !first.ok) throw first.error;
        if ("timeout" in first) throw new Error("paused revalidation did not reach its deterministic barrier");
        await driver.execute("lifecycle.manualInvalidate", { workspaceId, recordId: "race-record" });
        await driver.execute("lifecycle.softDelete", { workspaceId, recordId: "deleted-race-record", reason: "race fixture" });
        await resume.arriveAndWait();
        const completion = await inFlightOutcome;
        if (!completion.ok) throw completion.error;
        const state: any = await driver.inspect(workspaceId);
        const trace = await driver.trace("S4-03");
        const assertions = [a("manual invalidation is not restored", state.records?.find((x: any) => x.id === "race-record")?.active === false, state.records), a("soft-deleted record is not restored", state.records?.find((x: any) => x.deletedAt)?.active === false, state.records), a("race outcome is audited", trace.some((x: any) => x.type === "revalidation_restore_refused"), trace)];
        return { caseId: "S4-03", status: assertions.every((x) => x.passed) ? "pass" : "fail", assertions };
      } catch (error) {
        if (isBlockedCapability(error)) return { caseId: "S4-03", status: "blocked", assertions: [], reason: error.message } as EvalResult;
        return { caseId: "S4-03", status: "fail", assertions: [a("race protocol completes", false, String(error))] };
      } finally { reached.releaseAll(); resume.releaseAll(); await driver.close(); }
    },
  },
  operationCase("S4-04", "Hard and soft deletion permissions", "lifecycle.deletionPermissions", {
    workspaceId: ws("S4-04"), attempts: [{ actor: "agent", mode: "hard" }, { actor: "owner", mode: "hard" }, { actor: "agent", mode: "soft", reason: "superseded evidence" }], projectType: "configured",
  }, (o, s) => [a("agent hard deletion denied", o.results?.[0]?.status === "denied", o.results), a("owner hard deletion allowed", o.results?.[1]?.status === "deleted", o.results), a("autonomous soft deletion stores reason and history", o.results?.[2]?.status === "deleted" && s.history?.some((x: any) => x.type === "soft_deleted" && x.reason), { results: o.results, history: s.history })]),
  operationCase("S4-05", "Hourly activity detects a spike and stores cadence", "lifecycle.activityCadence", {
    workspaceId: ws("S4-05"), clockStart: "2026-09-07T00:00:00Z", signals: [{ atHour: 0, newUsersPerDay: 5 }, { atHour: 1, newUsersPerDay: 100 }], cadenceBoundsHours: [24, 168],
  }, (o, s) => [a("spike detected at next hourly check", o.detectedAt === "2026-09-07T01:00:00.000Z", o), a("cadence stays within configured bounds", o.cadenceHours >= 24 && o.cadenceHours <= 168, o), a("next run and nonempty reason persist", Boolean(s.schedule?.nextRunAt && typeof s.schedule?.reason === "string" && s.schedule.reason.length > 0), s.schedule), a("decision references the observed spike structurally", s.schedule?.evidence?.newUsersPerDay === 100 && s.schedule?.evidence?.observedAt === "2026-09-07T01:00:00.000Z", s.schedule?.evidence)]),
  operationCase("S4-06", "Schedule bounds, retry, and restart", "lifecycle.scheduleReliability", {
    workspaceId: ws("S4-06"), proposalsHours: [23, 169], retryOperationId: "schedule-once", simulateRestart: true,
  }, (o, s, trace) => [a("out-of-bounds proposals clamp or reject", o.proposals?.length === 2 && o.proposals.every((x: any) => x.status === "rejected" || (x.hours >= 24 && x.hours <= 168)), o.proposals), a("schedule survives restart", s.schedule?.persistedAfterRestart === true, s.schedule), a("scheduled occurrence runs once", trace.filter((x: any) => x.type === "proactive_run_started" && x.payload?.operationId === "schedule-once").length === 1, trace)]),
  operationCase("S4-07", "Proactive cap counts invalidated records", "lifecycle.weeklyCap", {
    workspaceId: ws("S4-07"), weeklyCap: 2, sequence: ["proactive", "proactive", "invalidate-first", "delete-second", "proactive", "requested"],
  }, (o, s) => [a("two proactive saves exhaust quota", o.results?.filter((x: any) => x.mode === "proactive" && x.saved).length === 2, o.results), a("invalidation and deletion do not free quota", s.usage?.proactiveCount === 2 && o.results?.find((x: any) => x.step === 5)?.status === "cap_reached", { usage: s.usage, results: o.results }), a("explicit requested generation remains allowed", o.results?.find((x: any) => x.mode === "requested")?.saved === true, o.results)]),
  {
    id: "S4-08", title: "Concurrent runs atomically reserve the last slot", layer: "contracts",
    async run() {
      const driver = await createCeresEvalDriver();
      try {
        const workspaceId = ws("S4-08");
        await driver.execute("lifecycle.seedQuota", { workspaceId, cap: 2, used: 1 });
        const before: any = await driver.inspect(workspaceId);
        const barrier = new AsyncBarrier(2);
        const attempts = ["concurrent-a", "concurrent-b"].map(async (operationId) => {
          await barrier.arriveAndWait();
          return driver.execute("lifecycle.claimProactiveSlot", { workspaceId, operationId });
        });
        const results: any[] = await Promise.all(attempts);
        const state: any = await driver.inspect(workspaceId);
        const trace = await driver.trace("S4-08");
        const beforeIds = new Set((before.hypotheses ?? []).map((x: any) => x.id));
        const saved = (state.hypotheses ?? []).filter((x: any) => !beforeIds.has(x.id));
        const assertions = [a("exactly one concurrent hypothesis is persisted", saved.length === 1, { before: before.hypotheses, after: state.hypotheses }), a("quota count never exceeds cap", state.usage?.proactiveCount === 2, state.usage), a("one atomic reservation is recorded", trace.filter((x: any) => x.type === "quota_reserved" && ["concurrent-a", "concurrent-b"].includes(x.payload?.operationId)).length === 1, trace)];
        return { caseId: "S4-08", status: assertions.every((x) => x.passed) ? "pass" : "fail", assertions };
      } catch (error) {
        if (isBlockedCapability(error)) return { caseId: "S4-08", status: "blocked", assertions: [], reason: error.message } as EvalResult;
        return { caseId: "S4-08", status: "fail", assertions: [a("concurrent protocol completes", false, String(error))] };
      } finally { await driver.close(); }
    },
  },
  operationCase("S4-09", "Weekly resets honor timezone and deduplication", "lifecycle.weeklyBoundary", {
    workspaceId: ws("S4-09"), configurations: [{ timezone: "UTC", before: "2026-09-13T23:59:59.999Z", at: "2026-09-14T00:00:00.000Z" }, { timezone: "America/Argentina/Buenos_Aires", before: "2026-09-14T02:59:59.999Z", at: "2026-09-14T03:00:00.000Z" }], operationId: "retry-id", duplicateClaim: "same normalized claim",
  }, (o) => [a("counter resets exactly at both configured boundaries", o.boundaries?.length === 2 && o.boundaries.every((x: any) => x.beforeSnapshot?.count > 0 && x.atSnapshot?.count === 0), o.boundaries), a("retry is represented by one persisted usage record", o.usageRecords?.filter((x: any) => x.operationId === "retry-id").length === 1, o.usageRecords), a("duplicate claim neither saves nor adds a usage record", o.duplicateSaved === false && o.usageRecords?.filter((x: any) => x.claim === "same normalized claim").length === 1, o)]),
  operationCase("S4-10", "Demo workspaces cannot schedule proactive jobs", "lifecycle.demoScheduler", {
    workspaceId: ws("S4-10"), workspaceType: "public-demo", directSchedulingRequest: true,
  }, (o, s, trace) => [a("direct scheduling request rejected", o.status === "rejected", o), a("no schedule persists", !s.schedule, s), a("no proactive job scheduled or executed", !trace.some((x: any) => ["job_scheduled", "proactive_run_started"].includes(x.type)), trace)]),
  operationCase("S4-11", "Monitoring failure and stable signals stay truthful", "lifecycle.monitoringOutcomes", {
    workspaceId: ws("S4-11"), attempts: ["provider-failure", "stable", "stable"], retryLimit: 1,
  }, (o, s, trace) => [a("failed check logged without fabricated activity", trace.some((x: any) => x.type === "activity_check_failed") && !o.fabricatedActivity, trace), a("recovery is bounded", o.providerAttempts <= 2, o), a("stable signals do not force schedule changes", s.schedule?.changeCount === 0, s.schedule)]),
];

assert.equal(lifecycleCases.length, 11);
