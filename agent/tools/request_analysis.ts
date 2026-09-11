import { defineTool } from 'eve/tools';
import { requestSchema } from '../../core/workflow.ts';
import { getRuntime } from '../../core/runtime.ts';
export default defineTool({description:'Run and save requested analytics, validated insights, and optional bounded Linkup research leading to a tentative hypothesis. Set research=false for an analytics-only request. Workspace scope is fixed by the authenticated server.',inputSchema:requestSchema,async execute(input) { return (await getRuntime()).workflow.execute(input); }});
