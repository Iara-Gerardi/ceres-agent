import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { PostgresStore } from '../adapters/postgres-store.ts';
import { uuid7 } from '../core/contracts.ts';
import sample from '../config/sample.json' with {type:'json'};

/** Real PostgreSQL engine, serialized pg-compatible client. No mocked SQL/transactions. */
export async function database() {
  const db = new PGlite();
  for (const file of ['001_foundation.sql','002_roles.sql']) await db.exec(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
  let tail = Promise.resolve();
  const query = async (sql:string,params?:unknown[]) => {
    // PGlite uses one session, so emulate a pool checkout without interleaving transactions.
    const r = await db.query(sql,params); return {rows:r.rows,rowCount:r.affectedRows || r.rows.length};
  };
  const pool = { async connect() { const previous=tail; let release!:()=>void; tail=new Promise<void>(r=>{release=r;}); await previous; return {query,release}; } } as unknown as Pool;
  const workspace=uuid7(); const foreign=uuid7();
  for(const w of [workspace,foreign]) await db.query('INSERT INTO ceres.workspaces(id,owner_id,config) VALUES($1,$2,$3)',[w,'owner',sample]);
  return {db,pool,workspace,foreign,store:new PostgresStore(pool,workspace,'owner'),foreignStore:new PostgresStore(pool,foreign,'owner'),close:()=>db.close()};
}
