import { defineTool } from 'eve/tools';
import { z } from 'zod';
export default defineTool({description:'Standalone research is disabled. Use request_analysis to search Linkup within a saved, budgeted creation workflow.',inputSchema:z.object({query:z.string().min(1).max(2000)}).strict(),async execute() {throw new Error('Research requires a creation workflow; use request_analysis');}});
