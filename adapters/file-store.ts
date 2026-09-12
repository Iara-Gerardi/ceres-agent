import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { id, uuid7, type Document, type Store } from '../core/contracts.ts';

type Entry = {
  operation: string;
  created_at: string;
  snapshot: Document;
};

/** Small append-only store for the single-project demo. */
export class FileStore implements Store {
  private tail = Promise.resolve();

  constructor(private path: string, private now = () => new Date()) {}

  private async entries(): Promise<Entry[]> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return text.split('\n').filter(Boolean).map((line, index) => {
      try { return JSON.parse(line) as Entry; }
      catch { throw new Error(`Record store is corrupt at line ${index + 1}`); }
    });
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await work(); }
    finally { release(); }
  }

  async save(run: string, kind: string, body: Record<string, unknown>, operation: string, existing?: {id:string;version:number}): Promise<Document> {
    id.parse(run); if (existing) id.parse(existing.id);
    if (!kind || !operation || operation.length > 200 || JSON.stringify(body).length > 500_000) throw new Error('Invalid persistence input');
    return this.exclusive(async () => {
      const entries = await this.entries();
      const retry = entries.find(entry => entry.operation === operation);
      if (retry) return retry.snapshot;
      const latest = new Map(entries.map(entry => [entry.snapshot.id, entry.snapshot]));
      const previous = existing ? latest.get(existing.id) : undefined;
      if (existing && (!previous || previous.version !== existing.version || previous.kind !== kind)) throw new Error('Revision conflict');
      const at = this.now().toISOString();
      const snapshot: Document = {
        ...body,
        id: previous?.id ?? uuid7(this.now().getTime()),
        run_id: run,
        kind,
        version: (previous?.version ?? 0) + 1,
        created_at: previous?.created_at ?? at,
        updated_at: at,
      };
      await mkdir(dirname(this.path), {recursive:true});
      await appendFile(this.path, `${JSON.stringify({operation,created_at:at,snapshot})}\n`, 'utf8');
      return snapshot;
    });
  }

  async get(recordId: string): Promise<Document> {
    id.parse(recordId);
    const matches = (await this.entries()).filter(entry => entry.snapshot.id === recordId);
    const record = matches.at(-1)?.snapshot;
    if (!record) throw new Error('Record unavailable');
    return record;
  }

  async list(kind?: string): Promise<Document[]> {
    const latest = new Map<string, Document>();
    for (const entry of await this.entries()) latest.set(entry.snapshot.id, entry.snapshot);
    return [...latest.values()].filter(record => !kind || record.kind === kind).sort((a,b) => a.id.localeCompare(b.id)).slice(0,1000);
  }

  async history(recordId: string) {
    id.parse(recordId);
    return (await this.entries())
      .filter(entry => entry.snapshot.id === recordId)
      .map(({snapshot,operation,created_at}) => ({snapshot,operation,created_at}));
  }
}
