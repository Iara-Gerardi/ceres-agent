import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { configSchema,id,uuid7 } from '../core/contracts.ts';
const url=process.env.CERES_MIGRATION_DATABASE_URL;
if(!url || !process.env.CERES_OWNER_ID) throw new Error('Set migration database URL and CERES_OWNER_ID');
const config=configSchema.parse(JSON.parse(await readFile(process.env.CERES_CONFIG_PATH ?? new URL('../config/sample.json',import.meta.url),'utf8')));
const workspace=process.env.CERES_WORKSPACE_ID ? id.parse(process.env.CERES_WORKSPACE_ID):uuid7();
const pool=new Pool({connectionString:url,max:1});
try { await pool.query('INSERT INTO ceres.workspaces(id,owner_id,config) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[workspace,process.env.CERES_OWNER_ID,config]); console.log(`CERES_WORKSPACE_ID=${workspace}`); } finally {await pool.end();}
