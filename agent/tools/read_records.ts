import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { getRuntime } from '../../core/runtime.ts';
import { id } from '../../core/contracts.ts';
import { usable } from '../../core/validation.ts';
export default defineTool({description:'Inspect saved records, evidence, run failures, and revision history in this workspace. For reasoning, use current_only=true.',inputSchema:z.object({id:id.optional(),kind:z.enum(['insight','hypothesis','finding','analytics','run','failure','research_decision','research_stop','provider_attempt']).optional(),current_only:z.boolean().default(true),history:z.boolean().default(false)}).strict(),async execute(input) {const {store}=await getRuntime(); if(input.id) {const record=await store.get(input.id); return {record:input.current_only && ['insight','hypothesis'].includes(record.kind) && !usable(record) ? null : record,history:input.history ? await store.history(input.id):[]};} return (await store.list(input.kind)).filter(d => !input.current_only || !['insight','hypothesis'].includes(d.kind) || usable(d));}});
