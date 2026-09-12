import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../adapters/file-store.ts';
import { Pool } from 'pg';
import { PostgresStore } from '../adapters/postgres-store.ts';
import { uuid7 } from '../core/contracts.ts';

/** Isolated durable store for each product test. */
export async function testStore(fileOnly = false) {
  if (process.env.TEST_DATABASE_URL && !fileOnly) {
    const schema = `test_${uuid7().replaceAll('-', '')}`;
    const admin = new Pool({connectionString:process.env.TEST_DATABASE_URL});
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({connectionString:process.env.TEST_DATABASE_URL, options:`-c search_path=${schema}`});
    try {
      await pool.query(await readFile(new URL('../migrations/003_document_store.sql', import.meta.url), 'utf8'));
    } catch (error) {
      await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); throw error;
    }
    return {path:'', store:new PostgresStore(pool), pool, close:async()=>{
      await pool.end();
      try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await admin.end(); }
    }};
  }
  const directory = await mkdtemp(join(tmpdir(),'ceres-test-'));
  const path = join(directory,'records.jsonl');
  return {path,store:new FileStore(path),close:()=>rm(directory,{recursive:true,force:true})};
}
