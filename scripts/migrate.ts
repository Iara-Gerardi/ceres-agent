import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
const url=process.env.CERES_MIGRATION_DATABASE_URL;
if(!url) throw new Error('Set CERES_MIGRATION_DATABASE_URL to the Ceres storage database');
const pool=new Pool({connectionString:url,max:1});
try { for (const name of ['001_foundation.sql','002_roles.sql']) await pool.query(await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8')); console.log('Foundation migration applied'); } finally { await pool.end(); }
