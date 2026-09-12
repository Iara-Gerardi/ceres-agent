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
  uncertainties: z.array(z.string().max(2000)).max(30).default([]),
}).strict();
export type Candidate = z.infer<typeof candidateSchema>;
export type Metric = z.infer<typeof metricSchema>;
export const configSchema = z.object({
  version: z.string().min(1), name: z.string().min(1), sample: z.boolean(),
  analytics: z.object({ event: z.string().min(1), conversion: z.string().min(1), groups: z.array(z.string().min(1)).min(1).max(20), windows_hours: z.array(z.number().positive().max(2160)).max(5), identity_linking: z.boolean() }).strict(),
  validation: z.object({ version: z.literal('evidence-v1'), minimum_sample: z.number().int().positive(), ttq_hours: z.number().positive().max(8760) }).strict(),
  research: z.object({ max_attempts: z.number().int().min(0).max(8), max_results: z.number().int().min(1).max(10) }).strict(),
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
export interface ResearchAdapter { search(query: string, limit: number): Promise<{ name: string; url: string; content: string }[]> }
export const decisionSchema = z.object({ action: z.enum(['search', 'stop']), query: z.string().max(2000), reason: z.string().min(1).max(3000), finding_ids: z.array(id).max(50), uncertainties: z.array(z.string().max(2000)).max(30) }).strict();
export const findingAssessmentSchema = z.object({ finding_id:id, relevant:z.boolean(), summary:z.string().min(1).max(4000), uncertainty:z.string().max(3000), contradictions:z.array(z.string().max(2000)).max(20) }).strict();
export const assessmentSchema = z.object({ assessments:z.array(findingAssessmentSchema).max(10) }).strict();
