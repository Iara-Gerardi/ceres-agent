import { z } from 'zod';
import type { ResearchAdapter } from '../core/contracts.ts';
const resultSchema = z.object({ results: z.array(z.object({ name: z.string().max(2000), url: z.url().refine(u => /^https?:\/\//.test(u)), content: z.string().max(100000) })).max(10) });
export class Linkup implements ResearchAdapter {
  constructor(private apiKey: string, private request: typeof fetch = fetch) {}
  async search(query: string, limit: number) {
    if (!this.apiKey) throw new Error('Linkup credentials unavailable');
    const response = await this.request('https://api.linkup.so/v1/search', { method:'POST', headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'}, body: JSON.stringify({ q:query, depth:'standard', outputType:'searchResults', maxResults:limit }), signal:AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`Linkup provider status ${response.status}`);
    if (!response.body) throw new Error('Empty Linkup response');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const {done,value} = await reader.read(); if(done) break; size += value.length; if(size > 1_000_000) throw new Error('Linkup response exceeds limit'); chunks.push(value); } }
    finally { await reader.cancel(); }
    return resultSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))).results;
  }
}
