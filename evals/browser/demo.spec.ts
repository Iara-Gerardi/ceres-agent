import type { AssertionResult, EvalResult } from "../contracts.ts";

type BrowserObservation = {
  sampleProjectLabel?: string;
  submittedWithoutTeamCredentials?: boolean;
  resultVisible?: boolean;
  evidence?: Record<string, unknown>;
  isolated?: boolean;
  foreignReadStatus?: number;
  foreignMutationStatus?: number;
  lifecycle?: Record<string, unknown>;
  expiry?: Record<string, unknown>;
  crossingExpiry?: Record<string, unknown>;
  failure?: Record<string, unknown>;
  refresh?: Record<string, unknown>;
};

type BrowserAdapter = { runJourney(id: string): Promise<BrowserObservation>; close?(): Promise<void> };
type BrowserModule = { createBrowserAdapter?: () => BrowserAdapter | Promise<BrowserAdapter>; default?: BrowserAdapter | (() => BrowserAdapter | Promise<BrowserAdapter>) };

function result(caseId: string, assertions: AssertionResult[]): EvalResult {
  const failed = assertions.filter((item) => !item.passed);
  return { caseId, status: failed.length ? "fail" : "pass", assertions, ...(failed.length ? { reason: `Failed: ${failed.map((a) => a.name).join(", ")}` } : {}) };
}

function check(name: string, passed: boolean, evidence: unknown): AssertionResult { return { name, passed, evidence }; }

/** Adapter-neutral browser oracle. The future UI adapter must drive real contexts and accessible controls. */
export function evaluateBrowserObservation(caseId: string, value: BrowserObservation): EvalResult {
  switch (caseId) {
    case "S3-01": return result(caseId, [check("fresh visitor sees labeled sample project and completes a task without team credentials", Boolean(value.sampleProjectLabel?.match(/sample/i)) && value.submittedWithoutTeamCredentials === true && value.resultVisible === true, value)]);
    case "S3-02": {
      const e = value.evidence ?? {};
      return result(caseId, [check("evidence view matches persisted counts, validation, sources, progression, test, uncertainty, and history", e.matchesStoredValues === true && e.countsVisible === true && e.validationVisible === true && e.sourcesVisible === true && e.followUpProgressionVisible === true && e.suggestedTestVisible === true && e.uncertaintyVisible === true && e.historyVisible === true, e)]);
    }
    case "S3-03": return result(caseId, [check("two browser contexts remain isolated against UI and direct API probes", value.isolated === true && [403, 404].includes(value.foreignReadStatus ?? 0) && [403, 404].includes(value.foreignMutationStatus ?? 0), value)]);
    case "S3-04": {
      const lifecycle = value.lifecycle ?? {};
      return result(caseId, [check("invalidate, validated restore, soft-delete, history, and hard-delete denial are persisted", lifecycle.invalidated === true && lifecycle.restoredAfterValidation === true && lifecycle.softDeleted === true && lifecycle.historyMatchesStored === true && lifecycle.configuredProjectHardDeleteDenied === true, lifecycle)]);
    }
    case "S3-05": {
      const expiry = value.expiry ?? {};
      return result(caseId, [check("24h boundary and cleanup preserve only shared/configured data", expiry.accessBefore === true && expiry.accessAt === false && expiry.workspaceOwnedRemaining === 0 && expiry.sharedFixturePreserved === true && expiry.configuredProjectPreserved === true, expiry)]);
    }
    case "S3-06": {
      const crossing = value.crossingExpiry ?? {};
      return result(caseId, [check("crossing expiry stops provider calls and writes without resurrection", crossing.providerCallsAfterExpiry === 0 && crossing.writesAfterExpiry === 0 && crossing.resurrected === false, crossing)]);
    }
    case "S3-07": {
      const failure = value.failure ?? {};
      return result(caseId, [check("direct-call limits hold and UI ends with an actionable failure", failure.directCallRejected === true && failure.actionableMessageVisible === true && failure.loading === false && failure.inventedResult !== true, failure)]);
    }
    case "S3-08": {
      const refresh = value.refresh ?? {};
      return result(caseId, [check("refresh preserves completed run and schedule appears only for monitoring-enabled projects", refresh.completedRunInspectable === true && refresh.configuredScheduleSurvivedRestart === true && refresh.demoNextRunVisible === false && refresh.configuredNextRunVisible === true, refresh)]);
    }
    default: return { caseId, status: "fail", reason: "Unknown browser case", assertions: [] };
  }
}

async function adapter(): Promise<BrowserAdapter | undefined> {
  const path = process.env.EVAL_BROWSER_DRIVER_MODULE;
  if (!path) return undefined;
  const loaded = await import(path) as BrowserModule;
  const candidate = loaded.createBrowserAdapter ?? loaded.default;
  return typeof candidate === "function" ? await candidate() : candidate;
}

async function run(id: string): Promise<EvalResult> {
  let browser: BrowserAdapter | undefined;
  try {
    browser = await adapter();
    if (!browser) return { caseId: id, status: "blocked", reason: "No UI/browser adapter is configured; choose the UI and install browser tooling before binding EVAL_BROWSER_DRIVER_MODULE", assertions: [] };
    return evaluateBrowserObservation(id, await browser.runJourney(id));
  } catch (error) {
    return { caseId: id, status: "infrastructure_error", reason: error instanceof Error ? error.message : String(error), assertions: [] };
  } finally {
    await browser?.close?.();
  }
}

const journeys = [
  ["S3-01", "Fresh visitor completes a sample task"], ["S3-02", "Evidence inspection"],
  ["S3-03", "Two isolated browser contexts"], ["S3-04", "Lifecycle controls"],
  ["S3-05", "Expiry and cleanup"], ["S3-06", "Run crossing expiry"],
  ["S3-07", "Limits and actionable failures"], ["S3-08", "Refresh and deployment persistence"],
] as const;

export const browserCases = journeys.map(([id, title]) => ({ id, title, layer: "browser" as const, run: () => run(id) }));
