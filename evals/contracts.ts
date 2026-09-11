export type Status = 'pass' | 'fail' | 'blocked' | 'infrastructure_error';

export type AssertionResult = {
  name: string;
  passed: boolean;
  evidence: unknown;
};

export type EvalResult = {
  caseId: string;
  status: Status;
  assertions: AssertionResult[];
  reason?: string;
  trace?: TraceEvent[];
  metadata?: Record<string, unknown>;
};

export type TraceEvent = {
  sequence: number;
  runId: string;
  workspaceId: string;
  type: string;
  at: string;
  payload: Record<string, unknown>;
};

export interface CeresEvalDriver {
  execute(operation: string, input: Record<string, unknown>): Promise<unknown>;
  inspect(workspaceId: string): Promise<Record<string, unknown>>;
  trace(runId: string): Promise<TraceEvent[]>;
  advanceClock(isoTime: string): Promise<void>;
}

export type ExpectedConversion = {
  visitors: number;
  sameSessionSignups: number;
  within48hSignups: number;
};

export type GraderOracle = {
  conversions: Record<string, ExpectedConversion>;
  allowedSourceUrls: string[];
  maxProviderAttempts: number;
  observationCutoff: string;
  secretCanaries?: string[];
  foreignRecordIds?: string[];
};
