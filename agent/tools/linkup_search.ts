import { defineTool } from "eve/tools";
import { z } from "zod";

const inputSchema = z.object({
  query: z.string().min(1).max(10_000),
  depth: z.enum(["fast", "standard", "deep"]).default("standard"),
  outputType: z.enum(["searchResults", "sourcedAnswer"]).default("sourcedAnswer"),
  includeDomains: z.array(z.string().min(1)).max(20).optional(),
  excludeDomains: z.array(z.string().min(1)).max(20).optional(),
});

export default defineTool({
  description:
    "Search the live web through Linkup and return source-backed results. Use for current or verifiable facts that are not in the database.",
  inputSchema,
  async execute({ query, depth, outputType, includeDomains, excludeDomains }) {
    const apiKey = process.env.LINKUP_API_KEY;
    if (!apiKey) {
      throw new Error("LINKUP_API_KEY is not configured.");
    }

    const response = await fetch("https://api.linkup.so/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        depth,
        outputType,
        ...(includeDomains ? { includeDomains } : {}),
        ...(excludeDomains ? { excludeDomains } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`Linkup search failed (${response.status}): ${await response.text()}`);
    }

    return response.json();
  },
});