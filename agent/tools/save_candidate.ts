import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { candidateSchema,id,configSchema } from '../../core/contracts.ts';
import { saveCandidate } from '../../core/validation.ts';
import { getRuntime } from '../../core/runtime.ts';
export default defineTool({description:'Save or revise an insight/hypothesis against an existing run and its stored evidence. Validation derives trust and activation; invalid candidates remain inactive. Reuse operation_id for retries.',inputSchema:z.object({run_record_id:id,candidate:candidateSchema,operation_id:z.string().min(1).max(100),existing:z.object({id,version:z.number().int().positive()}).strict().optional()}).strict(),async execute(input) { const {store}=await getRuntime(); const run=await store.get(input.run_record_id); if(run.kind!=='run') throw new Error('Run record required'); return saveCandidate(store,configSchema.parse(run.config),run.run_id,input.candidate,input.operation_id,new Date(),input.existing); }});
