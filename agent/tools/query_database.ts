import { defineTool } from 'eve/tools';
import { z } from 'zod';
export default defineTool({
 description:'Raw SQL is disabled. Use request_analysis for configured, bounded, read-only analytics; read_records for workspace records.',
 inputSchema:z.object({query:z.string().min(1).max(10000),values:z.array(z.union([z.string(),z.number(),z.boolean(),z.null()])).max(100).default([])}).strict(),
 async execute() { throw new Error('Arbitrary SQL is disabled; use configured analysis definitions'); },
});
