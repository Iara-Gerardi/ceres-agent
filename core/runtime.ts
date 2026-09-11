import sampleEvents from '../config/sample-events.json' with {type:'json'};
import { Pool } from 'pg';
import { configSchema, id } from './contracts.ts';
import { PostgresStore } from '../adapters/postgres-store.ts';
import { EventAnalytics, postgresAnalytics } from '../adapters/analytics.ts';
import { Linkup } from '../adapters/linkup.ts';
import { ModelReasoner } from '../adapters/reasoner.ts';
import { AnalysisWorkflow } from './workflow.ts';
let runtime: ReturnType<typeof createRuntime> | undefined;
async function createRuntime() {
  const workspace = id.parse(process.env.CERES_WORKSPACE_ID);
  const owner = process.env.CERES_OWNER_ID;
  if (!owner || !process.env.CERES_DATABASE_URL) throw new Error('Ceres workspace storage is not configured');
  const pool = new Pool({connectionString:process.env.CERES_DATABASE_URL,max:5});
  const row = await pool.query('SELECT config FROM ceres.workspaces WHERE id=$1 AND owner_id=$2',[workspace,owner]);
  const config = configSchema.parse(row.rows[0]?.config);
  const store = new PostgresStore(pool,workspace,owner);
  const analytics = config.sample
    ? new EventAnalytics(async () => sampleEvents)
    : postgresAnalytics(new Pool({connectionString:required('ANALYTICS_DATABASE_URL'),max:2}),required('CERES_ANALYTICS_QUERY'));
  const workflow = new AnalysisWorkflow(store,analytics,new Linkup(process.env.LINKUP_API_KEY ?? ''),new ModelReasoner(process.env.CERES_RESEARCH_MODEL),config);
  return {store,workflow};
}
function required(name:string) { const value=process.env[name]; if(!value) throw new Error(`${name} is not configured`); return value; }
export function getRuntime() { return runtime ??= createRuntime().catch(() => { runtime=undefined; throw new Error('Ceres runtime unavailable; check server configuration'); }); }
