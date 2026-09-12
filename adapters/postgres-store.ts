import { Pool } from 'pg';
import { id, uuid7, type Document, type Store } from '../core/contracts.ts';

/** Current documents and an immutable revision trail, committed together. */
export class PostgresStore implements Store {
  constructor(private pool: Pool, private now = () => new Date()) {}

  async save(run: string, kind: string, body: Record<string, unknown>, operation: string, existing?: {id:string;version:number}): Promise<Document> {
    id.parse(run); if (existing) id.parse(existing.id);
    if (!kind || !operation || operation.length > 200 || JSON.stringify(body).length > 500_000) throw new Error('Invalid persistence input');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize retries of an operation even when they arrive on different connections.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [operation]);
      const retry = await client.query<{snapshot:Document}>('SELECT snapshot FROM ceres_document_revisions WHERE operation = $1', [operation]);
      if (retry.rows[0]) {
        await client.query('COMMIT');
        return retry.rows[0].snapshot;
      }
      const previous = existing
        ? (await client.query<{snapshot:Document}>('SELECT snapshot FROM ceres_documents WHERE id = $1 FOR UPDATE', [existing.id])).rows[0]?.snapshot
        : undefined;
      if (existing && (!previous || previous.version !== existing.version || previous.kind !== kind || previous.run_id !== run)) throw new Error('Revision conflict');
      const at = this.now();
      const snapshot: Document = {
        ...body, id: previous?.id ?? uuid7(at.getTime()), run_id: run, kind,
        version: (previous?.version ?? 0) + 1,
        created_at: previous?.created_at ?? at.toISOString(), updated_at: at.toISOString(),
      };
      if (previous) {
        await client.query('UPDATE ceres_documents SET version = $2, snapshot = $3 WHERE id = $1', [snapshot.id, snapshot.version, snapshot]);
      } else {
        await client.query('INSERT INTO ceres_documents (id, run_id, kind, version, snapshot) VALUES ($1, $2, $3, $4, $5)', [snapshot.id, run, kind, snapshot.version, snapshot]);
      }
      await client.query('INSERT INTO ceres_document_revisions (operation, document_id, version, created_at, snapshot) VALUES ($1, $2, $3, $4, $5)', [operation, snapshot.id, snapshot.version, snapshot.updated_at, snapshot]);
      await client.query('COMMIT');
      return snapshot;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(recordId: string): Promise<Document> {
    id.parse(recordId);
    const result = await this.pool.query<{snapshot:Document}>('SELECT snapshot FROM ceres_documents WHERE id = $1', [recordId]);
    if (!result.rows[0]) throw new Error('Record unavailable');
    return result.rows[0].snapshot;
  }

  async list(kind?: string): Promise<Document[]> {
    const result = await this.pool.query<{snapshot:Document}>(
      'SELECT snapshot FROM ceres_documents WHERE ($1::text IS NULL OR kind = $1) ORDER BY id LIMIT 1000', [kind || null],
    );
    return result.rows.map(row => row.snapshot);
  }

  async history(recordId: string) {
    id.parse(recordId);
    const result = await this.pool.query<{snapshot:Document;operation:string}>(
      'SELECT snapshot, operation FROM ceres_document_revisions WHERE document_id = $1 ORDER BY version', [recordId],
    );
    return result.rows.map(row => ({...row, created_at:row.snapshot.updated_at}));
  }
}

export function createPostgresPool(connectionString: string): Pool {
  const pool = new Pool({connectionString, max:10, connectionTimeoutMillis:5000, idleTimeoutMillis:30000, allowExitOnIdle:true});
  // Idle connection failures should not terminate the server or expose credentials.
  pool.on('error', () => console.error('Ceres PostgreSQL idle connection failed'));
  return pool;
}
