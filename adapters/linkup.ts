import { z } from 'zod';
import { researchSearchOptionsSchema, type ResearchAdapter } from '../core/contracts.ts';
const resultSchema = z.object({ results: z.array(z.object({ name: z.string().max(2000), url: z.url().refine(u => /^https?:\/\//.test(u)), content: z.string().max(100000) })).max(10) });
const fetchSchema = z.object({ markdown:z.string().max(500000) }).passthrough();

export class LinkupError extends Error {
  override name = 'LinkupError';
  constructor(message: string, readonly statusCode?: number) { super(message); }
}

export class Linkup implements ResearchAdapter {
  constructor(private apiKey: string, private request: typeof fetch = fetch) {}
  async search(query: string, limit: number, input?: Parameters<ResearchAdapter['search']>[2]) {
    if (!this.apiKey) throw new LinkupError('Linkup credentials unavailable', 401);
    const options=researchSearchOptionsSchema.parse(input??{});const body:Record<string,unknown>={q:query,depth:options.depth,outputType:'searchResults',maxResults:limit};
    if(options.include_domains.length)body.includeDomains=options.include_domains;
    if(options.exclude_domains.length)body.excludeDomains=options.exclude_domains;
    if(options.from_date)body.fromDate=options.from_date;if(options.to_date)body.toDate=options.to_date;
    const response = await this.request('https://api.linkup.so/v1/search', { method:'POST', headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'}, body: JSON.stringify(body), signal:AbortSignal.timeout(45000) });
    return resultSchema.parse(await this.read(response,1_000_000)).results;
  }
  async fetch(url: string) {
    if (!this.apiKey) throw new LinkupError('Linkup credentials unavailable', 401);
    const response = await this.request('https://api.linkup.so/v1/fetch', { method:'POST', headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'}, body:JSON.stringify({url,mode:'standard',renderJs:true}), signal:AbortSignal.timeout(45000) });
    return fetchSchema.parse(await this.read(response,1_000_000));
  }
  private async read(response: Response, limit: number) {
    if (!response.ok) throw new LinkupError(`Linkup provider status ${response.status}`,response.status);
    if (!response.body) throw new LinkupError('Empty Linkup response');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const {done,value} = await reader.read(); if(done) break; size += value.length; if(size > limit) throw new Error('Linkup response exceeds limit'); chunks.push(value); } }
    finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }
}
