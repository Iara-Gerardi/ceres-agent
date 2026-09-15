import { defineTool } from 'eve/tools';
import { workflowActionSchema } from '../../core/workflow.ts';
import { getRuntime } from '../../core/runtime.ts';

export default defineTool({
  description:'Analyze Ceres\'s built-in synthetic mock events and advance the evidence-review state machine by exactly one permitted action. The returned analytics snapshot explicitly identifies the mock source; this tool never queries PostHog. Start, persist claims and gaps with plan_research, search only for named gaps, optionally fetch decisive sources, assess exact passages, then submit a bounded hypothesis or complete without one. Use only next_actions and the returned run_id/state_version. Invalid ordering, stale state, unknown evidence, unsupported passages, and false sufficient-evidence claims are rejected.',
  inputSchema:workflowActionSchema,
  async execute(input){return (await getRuntime()).workflow.transition(input);},
});
