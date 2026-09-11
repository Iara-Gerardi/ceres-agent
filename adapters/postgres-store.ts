import type { Pool, PoolClient } from 'pg';
import { id, uuid7, type Store, type Document } from '../core/contracts.ts';

/** Context is bound by the server, never taken from model/tool input. */
export class PostgresStore implements Store {
  constructor(private pool: Pool, private workspace: string, private owner: string, private now = () => new Date()) { id.parse(workspace); }
  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('ceres.workspace_id',$1,true)", [this.workspace]);
      const w = await c.query('SELECT id FROM ceres.workspaces WHERE id=$1 AND owner_id=$2 AND (expires_at IS NULL OR expires_at > $3) FOR SHARE', [this.workspace, this.owner, this.now().toISOString()]);
      if (!w.rowCount) throw new Error('Workspace unavailable');
      const result = await fn(c); await c.query('COMMIT'); return result;
    } catch { await c.query('ROLLBACK'); throw new Error('Scoped persistence operation rejected'); }
    finally { c.release(); }
  }
  async save(run: string, kind: string, body: Record<string, unknown>, operation: string, existing?: {id:string;version:number}): Promise<Document> {
    id.parse(run); if (existing) id.parse(existing.id);
    if (!operation || operation.length > 200 || JSON.stringify(body).length > 500_000) throw new Error('Invalid persistence input');
    return this.transaction(async c => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [this.workspace + operation]);
      const retry = await c.query('SELECT snapshot FROM ceres.history WHERE workspace_id=$1 AND operation=$2', [this.workspace, operation]);
      if (retry.rowCount) return retry.rows[0].snapshot;
      let previous: Document | undefined;
      if (existing) {
        const row = await c.query('SELECT body FROM ceres.documents WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [this.workspace, existing.id]);
        previous = row.rows[0]?.body;
        if (!previous || previous.version !== existing.version || previous.kind !== kind) throw new Error('Revision conflict');
      }
      const at = this.now().toISOString();
      const doc: Document = { ...body, id: previous?.id ?? uuid7(this.now().getTime()), workspace_id: this.workspace, run_id: run, kind, version: (previous?.version ?? 0) + 1, created_at: previous?.created_at ?? at, updated_at: at };
      await c.query('INSERT INTO ceres.documents(workspace_id,id,run_id,kind,version,body) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,id) DO UPDATE SET version=excluded.version,body=excluded.body', [this.workspace,doc.id,run,kind,doc.version,doc]);
      await c.query('INSERT INTO ceres.history(workspace_id,id,document_id,run_id,operation,version,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)', [this.workspace,uuid7(),doc.id,run,operation,doc.version,doc]);
      return doc;
    });
  }
  async get(recordId: string): Promise<Document> {
    id.parse(recordId);
    return this.transaction(async c => {
      const r = await c.query('SELECT body FROM ceres.documents WHERE workspace_id=$1 AND id=$2', [this.workspace,recordId]);
      if (!r.rowCount) throw new Error('Record unavailable'); return r.rows[0].body;
    });
  }
  async list(kind?: string): Promise<Document[]> {
    return this.transaction(async c => (await c.query('SELECT body FROM ceres.documents WHERE workspace_id=$1 AND ($2::text IS NULL OR kind=$2) ORDER BY id LIMIT 1000',[this.workspace,kind ?? null])).rows.map(x => x.body));
  }
  async history(recordId: string) {
    id.parse(recordId);
    return this.transaction(async c => (await c.query('SELECT snapshot,operation,created_at FROM ceres.history WHERE workspace_id=$1 AND document_id=$2 ORDER BY version', [this.workspace, recordId])).rows);
  }
}
