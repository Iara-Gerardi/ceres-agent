import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export function uuid7(now = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6); bytes[6] = (bytes[6]! & 15) | 112; bytes[8] = (bytes[8]! & 63) | 128;
  const s = bytes.toString('hex');
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}
export const id = z.uuidv7();
export const periodSchema = z.object({ start: z.iso.datetime(), end: z.iso.datetime() }).strict().refine(x => Date.parse(x.start) < Date.parse(x.end), 'Invalid period');
const count = z.number().int().nonnegative();
export const usageSchema = z.object({ used: count.nullable(), read: count.nullable(), exclusions: z.array(z.string().min(1)) }).strict().refine(x => x.used === null || x.read === null || (x.used <= x.read && (x.used === x.read || x.exclusions.length > 0)), 'Invalid evidence usage');
export const metricSchema = z.object({ metric: z.string().min(1), value: z.number().finite().nullable(), unit: z.string(), numerator: count.nullable(), denominator: count.nullable(), population: z.string().min(1), period: periodSchema }).strict().refine(x => x.numerator === null || x.denominator === null || (x.numerator <= x.denominator && (x.denominator !== 0 || x.value === null)), 'Invalid metric counts').refine(x => x.unit !== 'fraction' || x.numerator === null || x.denominator === null || x.denominator === 0 || (x.value !== null && Math.abs(x.value - x.numerator / x.denominator) < 1e-10), 'Metric value disagrees with ratio');
export const candidateSchema = z.object({
  kind: z.enum(['insight', 'hypothesis']), statement: z.string().min(1).max(6000),
  source_ids: z.array(id).max(50), key_metrics: z.array(z.string().min(1)).max(30),
  suggested_test: z.string().max(4000).default(''), category: z.string().max(100).default('conversion'),
  uncertainties: z.array(z.string().max(2000)).max(300).default([]),
  claim_ids: z.array(id).max(100).default([]),
}).strict();
export type Candidate = z.infer<typeof candidateSchema>;
export type Metric = z.infer<typeof metricSchema>;
export const configSchema = z.object({
  version: z.string().min(1), name: z.string().min(1), sample: z.boolean(),
  analytics: z.object({ event: z.string().min(1), conversion: z.string().min(1), groups: z.array(z.string().min(1)).min(1).max(20), windows_hours: z.array(z.number().positive().max(2160)).max(5), identity_linking: z.boolean() }).strict(),
  validation: z.object({ version: z.literal('evidence-v1'), minimum_sample: z.number().int().positive(), ttq_hours: z.number().positive().max(8760) }).strict(),
  research: z.object({
    max_attempts: z.number().int().min(0).max(8),
    max_results: z.number().int().min(1).max(10),
    max_fetches: z.number().int().min(0).max(10).default(2),
  }).strict(),
}).strict();
export type ProjectConfig = z.infer<typeof configSchema>;
export type Document = { id: string; run_id: string; kind: string; version: number; created_at: string; updated_at: string; [key: string]: unknown };
export interface Store {
  save(run: string, kind: string, body: Record<string, unknown>, operation: string, existing?: { id: string; version: number }): Promise<Document>;
  get(id: string): Promise<Document>;
  list(kind?: string): Promise<Document[]>;
  history(id: string): Promise<{ snapshot: Document; operation: string; created_at: string }[]>;
}
export interface AnalyticsAdapter { read(config: ProjectConfig, period: z.infer<typeof periodSchema>): Promise<{ metrics: Metric[]; snapshot: unknown; usage: z.infer<typeof usageSchema>; failures: string[] }> }
const domainSchema=z.string().trim().max(253).regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i,'Expected a domain name without a URL path');
export const researchSearchOptionsSchema = z.object({
  depth:z.enum(['standard','deep']).default('standard'),include_domains:z.array(domainSchema).max(100).default([]),
  exclude_domains:z.array(domainSchema).max(100).default([]),from_date:z.iso.date().nullable().default(null),
  to_date:z.iso.date().nullable().default(null),
}).strict().refine(value=>value.from_date===null||value.to_date===null||value.from_date<value.to_date,'from_date must precede to_date')
  .refine(value=>!value.include_domains.some(domain=>value.exclude_domains.some(excluded=>excluded.toLowerCase()===domain.toLowerCase())),
    'A domain cannot be both included and excluded');
export type ResearchSearchOptions = z.infer<typeof researchSearchOptionsSchema>;
export interface ResearchAdapter {
  search(query: string, limit: number, options?: ResearchSearchOptions): Promise<{ name: string; url: string; content: string }[]>;
  fetch?(url: string): Promise<{ markdown: string }>;
}
export const decisionSchema = z.object({ action:z.enum(['search','stop']),query:z.string().max(2000),reason:z.string().min(1).max(3000),
  finding_ids:z.array(id).max(50),gap_ids:z.array(id).max(50).default([]),search_options:researchSearchOptionsSchema.optional(),
  uncertainties:z.array(z.string().max(2000)).max(30) }).strict();

export const claimRoleSchema = z.enum(['observation','external_fact','inference','assumption']);
export const evidenceVerdictSchema = z.enum(['supported','refuted','mixed','insufficient_evidence']);
export const evidenceStatusSchema = evidenceVerdictSchema.or(z.literal('not_checked'));
const planKey = z.string().trim().regex(/^[a-z][a-z0-9_-]{0,49}$/);
export const claimPlanSchema = z.object({
  key:planKey, statement:z.string().trim().min(1).max(4000), role:claimRoleSchema, decisive:z.boolean(),source_id:id.nullable(),
}).strict().refine(value=>(value.role==='observation')===(value.source_id!==null),
  'Observation claims require a source_id; other claim roles must use null');
export const gapPlanSchema = z.object({
  key:planKey, question:z.string().trim().min(1).max(3000), affected_claim_keys:z.array(planKey).min(1).max(30),
  importance:z.enum(['blocking','material','context']),
  resolution_method:z.enum(['web_search','internal_analytics','product_inspection','experiment']),
  purpose:z.enum(['explain','verify','challenge']), reason:z.string().trim().min(1).max(3000),
}).strict();
export const claimEvidenceSchema = z.object({
  claim_id:id, verdict:evidenceVerdictSchema, passage:z.string().trim().max(4000),
  fetched_document_id:id.nullable().default(null),
}).strict().refine(value => value.verdict === 'insufficient_evidence' || value.passage.length > 0,
  'Supported, refuted, or mixed evidence requires a passage');
export const findingAssessmentSchema = z.object({
  finding_id:id, relevant:z.boolean(), summary:z.string().min(1).max(4000),
  uncertainty:z.string().max(3000), contradictions:z.array(z.string().max(2000)).max(20),
  source_type:z.enum(['official','primary_research','news','industry','community','vendor','unknown']),
  publication_date:z.iso.date().nullable(), source_origin:z.string().trim().min(1).max(2000).nullable(),
  independence:z.enum(['original','derived','unknown']), evidence:z.array(claimEvidenceSchema).max(30),
}).strict().refine(value => !value.relevant || value.evidence.length > 0,
  'Relevant findings require claim-level evidence');
export const gapResolutionSchema = z.object({
  gap_id:id, status:z.enum(['resolved','blocked']), evidence_ids:z.array(id).max(30),
  reason:z.string().trim().min(1).max(3000),
}).strict().refine(value => value.status !== 'resolved' || value.evidence_ids.length > 0,
  'Resolved gaps require evidence');
export const assessmentSchema = z.object({assessments:z.array(findingAssessmentSchema).max(10),
  gap_resolutions:z.array(gapResolutionSchema).max(50).default([])}).strict();
