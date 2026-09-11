import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { assertCompleteRegistry, gateExitCode, redact, validateProvenance, validateResult, writeReport } from './reporting.ts';
import type { EvalCase, Layer, RecordedResult } from './reporting.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const mode = args.shift() ?? 'contracts';
if (!['contracts', 'agent', 'browser', 'live', 'release'].includes(mode)) {
  throw new Error('Use contracts, agent, browser, live, or release.');
}
let selectedId: string | undefined;
while (args.length) {
  const arg = args.shift();
  if (arg === '--case' && args[0] && !selectedId) selectedId = args.shift();
  else throw new Error(`Unknown or incomplete argument: ${arg}`);
}
if (mode === 'release' && selectedId) throw new Error('Release must run every required case; --case is unavailable.');

const startedAt = new Date().toISOString();
const calibrationTests = (await readdir(resolve(root, 'evals/tests')))
  .filter(name => name.endsWith('.test.ts')).sort().map(name => resolve(root, 'evals/tests', name));
const calibration = spawnSync(process.execPath, ['--experimental-strip-types', '--test', ...calibrationTests], {
  cwd: root, encoding: 'utf8', timeout: 120_000, env: { ...process.env, EVAL_CALIBRATION_ONLY: '1' },
});
// Tool errors can include connection strings, so even test output is redacted.
process.stdout.write(String(redact(calibration.stdout ?? '')));
process.stderr.write(String(redact(calibration.stderr ?? '')));
const calibrationPassed = calibration.status === 0;
const { foundationCases } = await import('./cases/foundation.ts');
const { lifecycleCases } = await import('./cases/lifecycle.ts');
const { researchCases } = await import('./cases/research.ts');
const { demoCases } = await import('./cases/demo.ts');
const { browserCases } = await import('./browser/demo.spec.ts');
const { liveCases } = await import('./live/linkup.ts');
const all: EvalCase[] = [...foundationCases, ...researchCases, ...lifecycleCases, ...demoCases, ...browserCases, ...liveCases];
assertCompleteRegistry(all);
const cases = all.filter(c => (mode === 'release' || c.layer === mode as Layer) && (!selectedId || c.id === selectedId));
if (!cases.length) throw new Error('No matching evaluation cases.');
const results: RecordedResult[] = [];
for (const scenario of cases) {
  for (let repetition = 1; repetition <= (scenario.layer === 'agent' ? 3 : 1); repetition++) {
    const start = performance.now();
    try {
      const result = validateProvenance(validateResult(await scenario.run(), scenario.id), scenario.layer);
      results.push({ ...result, title: scenario.title, layer: scenario.layer, repetition, durationMs: performance.now() - start });
    } catch {
      results.push({ caseId: scenario.id, title: scenario.title, layer: scenario.layer, repetition,
        durationMs: performance.now() - start, status: 'infrastructure_error', assertions: [],
        reason: 'Unhandled adapter error; inspect the adapter locally. Raw exception omitted to protect credentials.' });
    }
    const result = results.at(-1)!;
    console.log(`${result.caseId} [${result.layer} ${repetition}]: ${result.status}`);
  }
}
const report = await writeReport(root, mode, results, calibrationPassed, startedAt);
console.log(`Report: ${report.directory}/summary.md`);
console.log(JSON.stringify(report.counts));
process.exitCode = calibrationPassed ? gateExitCode(results, mode === 'release') : 1;
