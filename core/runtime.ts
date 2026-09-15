import sampleEvents from '../config/sample-events.json' with {type:'json'};
import sampleConfig from '../config/sample.json' with {type:'json'};
import { resolve } from 'node:path';
import { configSchema } from './contracts.ts';
import { FileStore } from '../adapters/file-store.ts';
import { PostgresStore, createPostgresPool } from '../adapters/postgres-store.ts';
import { EventAnalytics, SYNTHETIC_MOCK_ANALYTICS_SOURCE } from '../adapters/analytics.ts';
import { Linkup } from '../adapters/linkup.ts';
import { AnalysisWorkflow } from './workflow.ts';
let runtime: ReturnType<typeof createRuntime> | undefined;
async function createRuntime() {
  const config = configSchema.parse(sampleConfig);
  const path = resolve(process.env.CERES_DATA_PATH ?? '.eve/ceres-records.jsonl');
  const pool = process.env.DATABASE_URL ? createPostgresPool(process.env.DATABASE_URL) : undefined;
  if (pool) {
    try { await pool.query('SELECT document_id FROM ceres_document_revisions LIMIT 0'); }
    catch (error) { await pool.end(); throw error; }
  }
  const store = pool ? new PostgresStore(pool) : new FileStore(path);
  const analytics = new EventAnalytics(async () => sampleEvents,SYNTHETIC_MOCK_ANALYTICS_SOURCE);
  const workflow = new AnalysisWorkflow(store,analytics,new Linkup(process.env.LINKUP_API_KEY ?? ''),config);
  return {store,workflow};
}
export function getRuntime() { return runtime ??= createRuntime().catch(() => { runtime=undefined; throw new Error('Ceres runtime unavailable; check DATABASE_URL and run npm run db:migrate, or check CERES_DATA_PATH for file storage'); }); }
