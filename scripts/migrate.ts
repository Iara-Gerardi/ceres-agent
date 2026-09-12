import { readFile } from 'node:fs/promises';
import { createPostgresPool } from '../adapters/postgres-store.ts';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before running migrations');
const pool = createPostgresPool(process.env.DATABASE_URL);
try {
  const sql = await readFile(new URL('../migrations/003_document_store.sql', import.meta.url), 'utf8');
  await pool.query(`BEGIN; ${sql} COMMIT;`);
  console.log('Ceres document store migration applied');
} catch {
  console.error('Ceres migration failed; check DATABASE_URL, connectivity, and schema permissions');
  process.exitCode = 1;
} finally {
  await pool.end();
}
