import { defineTool } from 'eve/tools';
import { experimentSchema, saveExperiment } from '../../core/experiments.ts';
import { getRuntime } from '../../core/runtime.ts';

export default defineTool({
  description: 'Save an experiment proposal after a completed research run, linked to its current hypothesis. Supported research may use confirmatory intent. Partial or inconclusive research requires exploratory intent and concrete prerequisites. First inspect your actual available tools for one that can make the proposed changes; record its exact name or null and explain why. This tool only persists the plan, never changes external systems or starts an experiment. Identical retries return the same experiment.',
  inputSchema: experimentSchema,
  async execute(input) {
    const { store } = await getRuntime();
    return saveExperiment(store, input);
  },
});
