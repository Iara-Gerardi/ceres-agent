import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import type { EvalResult, TraceEvent } from './contracts.ts';

export type Layer = 'contracts' | 'agent' | 'browser' | 'live';
export type EvalCase = { id: string; title: string; layer: Layer; run(): Promise<EvalResult> };
export type RecordedResult = EvalResult & {
  title: string; layer: Layer; repetition: number; durationMs: number;
  trace?: TraceEvent[]; metadata?: Record<string, unknown>; traceRef?: string;
};

export function requiredCoverage(): { id: string; layer: Layer }[] {
  const series = (prefix: string, start: number, end: number, layer: Layer) =>
    Array.from({ length: end - start + 1 }, (_, index) => ({ id: `${prefix}-${String(index + start).padStart(2, '0')}`, layer }));
  return [
    ...series('S1', 1, 12, 'contracts'), ...series('S4', 1, 11, 'contracts'),
    ...series('S2', 1, 10, 'agent'), ...series('S2', 11, 11, 'live'),
    ...series('S3', 3, 7, 'contracts'), ...series('S3', 1, 8, 'browser'),
    { id: 'S1-SCORER', layer: 'contracts' },
  ];
}

export function assertCompleteRegistry(cases: Pick<EvalCase, 'id' | 'layer'>[]): void {
  const keys = cases.map(c => `${c.layer}/${c.id}`);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate case ID within an evaluation layer.');
  const missing = requiredCoverage().filter(c => !keys.includes(`${c.layer}/${c.id}`));
  if (missing.length) throw new Error(`Required cases missing: ${missing.map(c => `${c.layer}/${c.id}`).join(', ')}`);
}

// Only explicit credential values are inspected; environment contents are never serialized.
export function redact(value: unknown, secrets: string[] = credentialValues()): unknown {
  const seen = new WeakSet<object>();
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') {
      let text = item;
      for (const secret of secrets.filter(s => s.length >= 4)) text = text.split(secret).join('[REDACTED]');
      return text.replace(/\b(?:postgres(?:ql)?):\/\/[^\s"'<>]+/gi, '[REDACTED_DATABASE_URL]')
        .replace(/\b(Bearer|Basic)\s+[^\s"'<>]+/gi, '$1 [REDACTED]')
        .replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
        .replace(/([?&](?:api[_-]?key|(?:access[_-]?|refresh[_-]?)?token|(?:client[_-]?)?secret|password)=)[^&#\s]+/gi, '$1[REDACTED]');
    }
    if (!item || typeof item !== 'object') return item;
    if (seen.has(item)) return '[Circular]';
    seen.add(item);
    if (Array.isArray(item)) return item.map(visit);
    return Object.fromEntries(Object.entries(item).map(([key, val]) => [key,
      /(?:authorization|cookie|password|secret|private[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|connectionString|database[_-]?url)/i.test(key)
        ? '[REDACTED]' : visit(val)]));
  };
  return visit(value);
}

function credentialValues(): string[] {
  return Object.entries(process.env).filter(([key]) => /(?:KEY|TOKEN|SECRET|PASSWORD|DATABASE.*URL|AUTHORIZATION)/i.test(key))
    .flatMap(([, value]) => value ? [value] : []);
}

export function gateExitCode(results: EvalResult[], release: boolean): number {
  if (!results.length) return 1;
  return results.some(result => result.status === 'fail' || result.status === 'infrastructure_error'
    || (release && result.status !== 'pass')) ? 1 : 0;
}

export function validateResult(result: EvalResult, expectedId: string): EvalResult {
  if (!result || result.caseId !== expectedId || !['pass', 'fail', 'blocked', 'infrastructure_error'].includes(result.status)
      || !Array.isArray(result.assertions) || result.assertions.some(a => !a || typeof a.name !== 'string' || typeof a.passed !== 'boolean')) {
    return { caseId: expectedId, status: 'fail', assertions: [], reason: 'Adapter returned an invalid evaluation result.' };
  }
  if (result.status === 'pass' && (!result.assertions.length || result.assertions.some(a => !a.passed))) {
    return { ...result, status: 'fail', reason: 'A pass requires nonempty, passing assertions.' };
  }
  if (result.status === 'blocked' && result.assertions.some(a => !a.passed)) {
    return { ...result, status: 'fail', reason: `Observed failed assertions cannot be hidden by a missing capability. ${result.reason ?? ''}`.trim() };
  }
  return result;
}

export function validateProvenance(result: EvalResult, layer: Layer): EvalResult {
  if (result.status !== 'pass' || (layer !== 'agent' && layer !== 'live')) return result;
  const metadata = result.metadata;
  const missing: string[] = [];
  for (const field of ['model', 'reasoning', 'promptVersion', 'skillVersion', 'configVersion']) {
    if (typeof metadata?.[field] !== 'string' || !String(metadata[field]).trim()) missing.push(field);
  }
  if (!metadata?.toolLimits || typeof metadata.toolLimits !== 'object') missing.push('toolLimits');
  if (!Number.isInteger(metadata?.providerAttempts) || Number(metadata?.providerAttempts) < 0) missing.push('providerAttempts');
  if (!Array.isArray(result.trace) || !result.trace.length) missing.push('trace');
  if (missing.length) return { ...result, status: 'blocked', reason: `Required run provenance is absent: ${missing.join(', ')}` };
  const recordedAttempts = result.trace!.filter(event => event.type === 'provider.attempt').length;
  if (metadata!.providerAttempts !== recordedAttempts) {
    return { ...result, status: 'fail', assertions: [...result.assertions,
      { name: 'provider usage matches recorded attempts', passed: false, evidence: { metadata: metadata!.providerAttempts, recordedAttempts } }],
      reason: 'Provider usage metadata disagrees with the public trace.' };
  }
  return result;
}

async function hashFiles(root: string, names: string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const name of [...names].sort()) {
    hash.update(name);
    hash.update(await readFile(resolve(root, name)));
  }
  return hash.digest('hex');
}

async function filesUnder(root: string, directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await filesUnder(root, name));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}

export async function writeReport(root: string, mode: string, results: RecordedResult[], calibrationPassed: boolean, startedAt: string) {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  const directory = resolve(root, 'evals/results', runId);
  await mkdir(directory, { recursive: true });
  const safeResults = redact(results) as RecordedResult[];
  for (const [index, result] of safeResults.entries()) {
    if (result.trace) {
      // Generated names avoid trusting IDs or paths supplied by an external adapter.
      result.traceRef = `trace-${index + 1}.json`;
      await writeFile(resolve(directory, result.traceRef), JSON.stringify(result.trace, null, 2) + '\n');
      delete result.trace;
    }
  }
  const fixtureFiles = await filesUnder(root, 'evals/fixtures');
  const skillFiles = await filesUnder(root, 'agent/skills');
  const counts = { pass: 0, fail: 0, blocked: 0, infrastructure_error: 0 };
  for (const result of safeResults) counts[result.status]++;
  const report = {
    schemaVersion: 1, runId, mode, startedAt, finishedAt: new Date().toISOString(),
    calibrationPassed, releaseAccepted: mode === 'release' && calibrationPassed && gateExitCode(results, true) === 0,
    versions: {
      node: process.version,
      harness: await hashFiles(root, (await filesUnder(root, 'evals')).filter(name => !name.startsWith('evals/results/'))),
      fixtures: await hashFiles(root, fixtureFiles),
      prompt: await hashFiles(root, ['agent/instructions.md']),
      skills: await hashFiles(root, skillFiles),
      agentConfig: await hashFiles(root, ['agent/agent.ts']),
      dependencies: await hashFiles(root, ['package-lock.json']),
      model: process.env.EVAL_MODEL ?? 'not recorded by product adapter',
      reasoning: process.env.EVAL_REASONING ?? 'not recorded by product adapter',
    },
    counts, results: safeResults,
  };
  await writeFile(resolve(directory, 'results.json'), JSON.stringify(redact(report), null, 2) + '\n');
  const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  const summary = [
    `# Ceres evaluation: ${mode}`, '', `Run: ${runId}`, '',
    `Harness calibration: ${calibrationPassed ? 'pass' : 'fail'}.`,
    `Product results: ${counts.pass} pass, ${counts.fail} fail, ${counts.blocked} blocked, ${counts.infrastructure_error} infrastructure errors.`,
    mode === 'release' ? `Release accepted: ${report.releaseAccepted}.` : 'This pre-build report does not establish product readiness.', '',
    '| Case | Layer | Repetition | Status | Reason |', '| --- | --- | --- | --- | --- |',
    ...safeResults.map(r => `| ${cell(r.caseId)} | ${r.layer} | ${r.repetition} | ${r.status} | ${cell(r.reason ?? r.title)} |`), '',
    'Assertions, hashes, durations, adapter metadata and redacted trace references are in results.json.',
    'Live verification is never replaced with fixture results. Blocked requirements fail the release gate.', '',
  ].join('\n');
  await writeFile(resolve(directory, 'summary.md'), summary);
  return { directory: relative(root, directory), counts, report };
}
