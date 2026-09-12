import { defineTool } from 'eve/tools';
import { workflowActionSchema } from '../../core/workflow.ts';
import { getRuntime } from '../../core/runtime.ts';

export default defineTool({
  description:'Advance the Ceres analysis state machine by exactly one permitted action. Start with action=start, then use only next_actions from each result with the returned run_id and state_version. Linkup is executed privately by submit_query; invalid ordering, stale state, unknown evidence, and ungrounded hypotheses are rejected.',
  inputSchema:workflowActionSchema,
  async execute(input){return (await getRuntime()).workflow.transition(input);},
});
