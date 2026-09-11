import type { CeresEvalDriver, TraceEvent } from "../contracts.ts";

export type EvalOperation = (input: Record<string, unknown>) => Promise<unknown>;

export type CeresDriverBindings = {
  operations?: Record<string, EvalOperation>;
  inspect?: (workspaceId: string) => Promise<Record<string, unknown>>;
  trace?: (runId: string) => Promise<TraceEvent[]>;
  advanceClock?: (isoTime: string) => Promise<void>;
  close?: () => Promise<void>;
};

export class BlockedCapabilityError extends Error {
  readonly code = "EVAL_CAPABILITY_BLOCKED";
  readonly capability: string;
  readonly reason: string;

  constructor(capability: string, reason = `No product binding is registered for ${capability}`) {
    super(reason);
    this.capability = capability;
    this.reason = reason;
    this.name = "BlockedCapabilityError";
  }
}

export function isBlockedCapability(error: unknown): error is BlockedCapabilityError {
  return error instanceof BlockedCapabilityError;
}

export class BoundCeresEvalDriver implements CeresEvalDriver {
  private readonly bindings: CeresDriverBindings;
  constructor(bindings: CeresDriverBindings = {}) { this.bindings = bindings; }

  has(capability: string): boolean {
    if (capability === "inspect" || capability === "trace" || capability === "advanceClock") {
      return typeof this.bindings[capability] === "function";
    }
    return typeof this.bindings.operations?.[capability] === "function";
  }

  async execute(operation: string, input: Record<string, unknown>): Promise<unknown> {
    const binding = this.bindings.operations?.[operation];
    if (!binding) throw new BlockedCapabilityError(operation);
    return binding(input);
  }

  async inspect(workspaceId: string): Promise<Record<string, unknown>> {
    if (!this.bindings.inspect) throw new BlockedCapabilityError("inspect");
    return this.bindings.inspect(workspaceId);
  }

  async trace(runId: string): Promise<TraceEvent[]> {
    if (!this.bindings.trace) throw new BlockedCapabilityError("trace");
    return this.bindings.trace(runId);
  }

  async advanceClock(isoTime: string): Promise<void> {
    if (!this.bindings.advanceClock) throw new BlockedCapabilityError("advanceClock");
    await this.bindings.advanceClock(isoTime);
  }

  async close(): Promise<void> {
    await this.bindings.close?.();
  }
}

type DriverModule = {
  createEvalBindings?: () => CeresDriverBindings | Promise<CeresDriverBindings>;
  default?: CeresDriverBindings | (() => CeresDriverBindings | Promise<CeresDriverBindings>);
};

let overrideFactory: (() => CeresDriverBindings | Promise<CeresDriverBindings>) | undefined;

/** Test/deployment composition point; product code owns the bindings, evals own expectations. */
export function setCeresEvalBindingsFactory(
  factory: (() => CeresDriverBindings | Promise<CeresDriverBindings>) | undefined,
): void {
  overrideFactory = factory;
}

export async function createCeresEvalDriver(): Promise<BoundCeresEvalDriver> {
  if (overrideFactory) return new BoundCeresEvalDriver(await overrideFactory());

  const modulePath = process.env.EVAL_CERES_DRIVER_MODULE;
  if (!modulePath) return new BoundCeresEvalDriver();
  const loaded = (await import(modulePath)) as DriverModule;
  const candidate = loaded.createEvalBindings ?? loaded.default;
  const bindings = typeof candidate === "function" ? await candidate() : candidate;
  if (!bindings || typeof bindings !== "object") {
    throw new Error("EVAL_CERES_DRIVER_MODULE did not export eval bindings");
  }
  return new BoundCeresEvalDriver(bindings);
}
