import { candidateSchema, metricSchema, usageSchema, type Candidate, type Document, type ProjectConfig, type Store, type Metric } from './contracts.ts';

export function usable(record: Document, now = new Date()): boolean {
  return record.active === true && !record.deleted_at && !record.manually_invalidated && typeof record.review_due_at === 'string' && Date.parse(record.review_due_at) > now.getTime();
}
/** Score is evidence quality: 60 core + 20 sample + 10 complete windows + 10 snapshot coverage. */
export function score(checks: { data: boolean; definitions: boolean; counts: boolean; traceable: boolean; sample: boolean; windows: boolean; coverage: boolean }) {
  const weights = { data: 15, definitions: 15, counts: 15, traceable: 15, sample: 20, windows: 10, coverage: 10 };
  const trust = Object.entries(weights).reduce((n,[k,w]) => n + (checks[k as keyof typeof checks] ? w : 0),0);
  return { trust, rule_version: 'evidence-v1', mandatory_passed: checks.data && checks.definitions && checks.counts && checks.traceable, checks, reasons: Object.entries(checks).filter(([,pass]) => !pass).map(([name]) => `${name} check failed`) };
}
export async function saveCandidate(store: Store, config: ProjectConfig, run: string, input: unknown, operation: string, now = new Date(), existing?: {id:string;version:number}) {
  const candidate: Candidate = candidateSchema.parse(input);
  const sources: Document[] = []; let traceable = candidate.source_ids.length > 0;
  for (const sourceId of candidate.source_ids) {
    try {
      const source = await store.get(sourceId);
      if (['insight','hypothesis'].includes(source.kind) && !usable(source,now)) traceable = false;
      else if (source.kind === 'finding' && source.relevant !== true) traceable = false;
      else if (!['analytics','finding','insight','hypothesis'].includes(source.kind)) traceable = false;
      else sources.push(source);
    } catch { traceable = false; }
  }
  // Analytics must originate from this workflow; external text cannot substitute for project data.
  const analytics = (await store.list('analytics')).filter(s => s.run_id === run);
  const allMetrics = analytics.flatMap(s => Array.isArray(s.metrics) ? s.metrics.map(m => metricSchema.parse(m)) : []);
  const metrics: Metric[] = allMetrics.filter(m => candidate.key_metrics.includes(m.metric));
  const usage = analytics.map(s => usageSchema.parse(s.usage));
  const validation = score({
    data: metrics.length > 0 && metrics.every(m => m.value !== null),
    definitions: candidate.key_metrics.length > 0 && candidate.key_metrics.every(k => allMetrics.some(m => m.metric === k)),
    counts: metrics.length > 0 && metrics.every(m => m.denominator !== null && m.numerator !== null && m.numerator <= m.denominator),
    traceable: traceable && sources.length === candidate.source_ids.length && (candidate.kind !== 'insight' || sources.some(s => s.kind === 'analytics')),
    sample: metrics.length > 0 && metrics.every(m => (m.denominator ?? 0) >= config.validation.minimum_sample),
    windows: metrics.length > 0 && analytics.every(a => Array.isArray(a.failures) && a.failures.length === 0),
    coverage: usage.length > 0 && usage.every(u => u.used !== null && u.read !== null && u.used === u.read),
  });
  const structure = candidate.kind === 'insight' || candidate.suggested_test.trim().length > 0;
  const active = validation.mandatory_passed && structure && (candidate.kind === 'hypothesis' || validation.trust >= 80);
  if (!structure) validation.reasons.push('Suggested test required');
  if (candidate.kind === 'insight' && validation.trust < 80) validation.reasons.push('Evidence quality below 80');
  if (existing) { const prior = await store.get(existing.id); if (prior.deleted_at || prior.manually_invalidated) throw new Error('Record cannot be automatically restored'); }
  return store.save(run,candidate.kind, { ...candidate, generation_mode: 'requested', trust: validation.trust, validation, active, inactive_reason: active ? null : validation.reasons.join('; '), review_due_at: new Date(now.getTime()+config.validation.ttq_hours*3600000).toISOString(), deleted_at: null, deletion_reason: null, sources, metric_observations: metrics, evidence_usage: usage },operation,existing);
}
