import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCompleteRegistry, gateExitCode, redact, requiredCoverage, validateProvenance, validateResult } from '../reporting.ts';
import type { EvalResult, Status } from '../contracts.ts';

const result = (status: Status): EvalResult => ({ caseId: 'example', status, assertions: [{ name: 'observed', passed: status === 'pass', evidence: true }] });
test('release coverage cannot silently drop a case or an acceptance layer', () => {
  const cases = requiredCoverage();
  assert.equal(new Set(cases.map(c => c.id)).size, 43); // 42 plan IDs plus the unresolved scorer gate.
  assert.doesNotThrow(() => assertCompleteRegistry(cases));
  assert.throws(() => assertCompleteRegistry(cases.slice(1)), /missing/);
  assert.throws(() => assertCompleteRegistry([...cases, cases[0]!]), /Duplicate/);
});
test('release rejects every incomplete or unsuccessful status without averaging', () => {
  assert.equal(gateExitCode([result('pass')], true), 0);
  for (const status of ['fail', 'blocked', 'infrastructure_error'] as const) {
    assert.equal(gateExitCode([result('pass'), result(status)], true), 1);
  }
  assert.equal(gateExitCode([], true), 1);
  assert.equal(gateExitCode([result('blocked')], false), 0);
  assert.equal(gateExitCode([result('infrastructure_error')], false), 1);
});
test('a malformed result or vacuous pass cannot open the gate', () => {
  assert.equal(validateResult(result('pass'), 'example').status, 'pass');
  assert.equal(validateResult(result('pass'), 'other').status, 'fail');
  assert.equal(validateResult({ ...result('pass'), assertions: [] }, 'example').status, 'fail');
  assert.equal(validateResult({ ...result('pass'), assertions: [{ name: 'wrong', passed: false, evidence: 0 }] }, 'example').status, 'fail');
  assert.equal(validateResult(result('blocked'), 'example').status, 'fail');
});
test('reports redact nested credentials, connection URLs and authorization text', () => {
  const safe = JSON.stringify(redact({ apiKey: 'abc', nested: [
    'postgresql://owner:password@host/db', 'Bearer credential', 'known-secret',
    'https://source.test/?api_key=sensitive', { cookie: 'session=hidden' },
  ], evidence: '30 of 50' }, ['known-secret']));
  for (const secret of ['password@', 'credential', 'known-secret', 'sensitive', 'session=hidden', '"abc"']) assert.equal(safe.includes(secret), false);
  assert.ok(safe.includes('30 of 50'));
});
test('reports redact credential aliases and URI/header credentials not present in the environment', () => {
  const safe = JSON.stringify(redact({ clientSecret: 'client-value', privateKey: 'private-value', headers: { 'x-api-key': 'key-value', proxyAuthorization: 'proxy-value' },
    evidence: ['Basic encoded-value', 'https://user:password-value@host.test/', 'https://host.test/?access_token=access-value'] }, []));
  for (const value of ['client-value', 'private-value', 'key-value', 'proxy-value', 'encoded-value', 'password-value', 'access-value']) assert.equal(safe.includes(value), false);
});
test('agent passes require actual provenance and usage consistent with their trace', () => {
  const good: EvalResult = { ...result('pass'), metadata: { model: 'fixture-model', reasoning: 'low', promptVersion: 'p1', skillVersion: 's1', configVersion: 'c1', toolLimits: { linkup: 3 }, providerAttempts: 0 },
    trace: [{ sequence: 1, runId: 'run', workspaceId: 'ws', at: '2026-09-10T00:00:00Z', type: 'analytics.completed', payload: {} }] };
  assert.equal(validateProvenance(result('pass'), 'agent').status, 'blocked');
  assert.equal(validateProvenance(good, 'agent').status, 'pass');
  assert.equal(validateProvenance({ ...good, metadata: { ...good.metadata, providerAttempts: 1 } }, 'agent').status, 'fail');
});
