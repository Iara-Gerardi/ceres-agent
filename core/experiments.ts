import { createHash } from 'node:crypto';
import { z } from 'zod';
import { candidateSchema, id, type Store } from './contracts.ts';
import { usable } from './validation.ts';

const text = (max: number) => z.string().trim().min(1).max(max);

export const experimentSchema = z.object({
  hypothesis_id: id,
  title: text(300),
  audience: text(2000),
  changes: z.array(z.object({
    target: text(1000), control: text(4000), treatment: text(4000), reason: text(2000),
  }).strict()).min(1).max(10),
  primary_metric: text(300),
  success_criterion: text(4000),
  guardrails: z.array(text(1000)).min(1).max(20),
  uncertainties: z.array(text(2000)).max(300).default([]),
  intent: z.enum(['confirmatory','exploratory']),
  prerequisites: z.array(text(2000)).max(50),
  // This is the agent's assessment of its session tools, not proof of execution.
  capability_check: z.object({tool_name: text(300).nullable(), reason: text(2000)}).strict(),
}).strict();

/** Save a proposal only. No external system is modified by this operation. */
export async function saveExperiment(store: Store, input: unknown, now = new Date()) {
  const proposal = experimentSchema.parse(input);
  const hypothesis = await store.get(proposal.hypothesis_id);
  if (hypothesis.kind !== 'hypothesis' || !usable(hypothesis, now)) {
    throw new Error('Experiment requires a current hypothesis');
  }
  const premise = candidateSchema.parse({kind:hypothesis.kind, statement:hypothesis.statement,
    source_ids:hypothesis.source_ids, key_metrics:hypothesis.key_metrics, suggested_test:hypothesis.suggested_test,
    category:hypothesis.category, uncertainties:hypothesis.uncertainties,claim_ids:hypothesis.claim_ids});
  if (!premise.key_metrics.includes(proposal.primary_metric)) {
    throw new Error('Experiment metric must be supported by the hypothesis');
  }
  const runs = await store.list('run');
  const completed = runs.some(run => run.run_id === hypothesis.run_id && run.status === 'completed'
    && (run.result_ids as {hypothesis?: string} | undefined)?.hypothesis === hypothesis.id);
  if (!completed) throw new Error('Experiment requires a completed research run');
  const researchStatus = hypothesis.research_status === 'supported' ? 'supported'
    : hypothesis.research_status === 'partial' ? 'partial' : 'inconclusive';
  if (researchStatus !== 'supported' && (proposal.intent !== 'exploratory' || proposal.prerequisites.length === 0)) {
    throw new Error('A partially supported or inconclusive hypothesis requires an exploratory experiment with prerequisites');
  }

  // Identical retries reuse the saved proposal; distinct proposals may share a hypothesis.
  const fingerprint = createHash('sha256').update(JSON.stringify({proposal,hypothesis_version:hypothesis.version})).digest('hex');
  return store.save(hypothesis.run_id, 'experiment', {
    ...proposal,
    hypothesis_version: hypothesis.version,
    source_ids: premise.source_ids,
    claim_ids: premise.claim_ids,
    research_status: researchStatus,
    evidence_assessment_ids: Array.isArray(hypothesis.evidence_assessment_ids) ? hypothesis.evidence_assessment_ids : [],
    gap_ids: Array.isArray(hypothesis.gap_ids) ? hypothesis.gap_ids : [],
    unresolved_gap_ids: Array.isArray(hypothesis.unresolved_gap_ids) ? hypothesis.unresolved_gap_ids : [],
    uncertainties: [...new Set([...premise.uncertainties, ...proposal.uncertainties])],
    status: 'proposed',
    execution_status: 'not_started',
    handoff: proposal.capability_check.tool_name === null ? 'manual' : 'tool_available',
  }, `${hypothesis.run_id}/experiment/${fingerprint}`);
}
