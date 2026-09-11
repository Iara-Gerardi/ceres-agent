import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { id } from '../../core/contracts.ts';
import { getRuntime } from '../../core/runtime.ts';
export default defineTool({description:'Soft-delete an insight or hypothesis with a recorded reason. Permanent deletion is unavailable to the agent.',inputSchema:z.object({id,reason:z.string().min(1).max(2000),operation_id:z.string().min(1).max(100)}).strict(),async execute(input) {const {store}=await getRuntime();const record=await store.get(input.id);if(!['insight','hypothesis'].includes(record.kind)) throw new Error('Insight or hypothesis required'); return store.save(record.run_id,record.kind,{...record,active:false,inactive_reason:'soft_deleted',deleted_at:new Date().toISOString(),deletion_reason:input.reason},input.operation_id,{id:record.id,version:record.version});}});
