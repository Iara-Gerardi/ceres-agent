import { defineTool } from "eve/tools";
import { Pool } from "pg";
import { z } from "zod";

const queryValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const inputSchema = z.object({
  query: z.string().min(1).max(10_000),
  values: z.array(queryValueSchema).max(100).default([]),
});

let pool: Pool | undefined;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured.");
    }

    const url = new URL(connectionString);
    url.searchParams.set("options", "-c default_transaction_read_only=on");
    pool = new Pool({ connectionString: url.toString() });
  }

  return pool;
}

function assertReadOnlyQuery(query: string) {
  const normalized = query.trim().replace(/;+\s*$/, "");
  if (!/^(select|with|explain)\b/i.test(normalized) || normalized.includes(";")) {
    throw new Error("Only a single read-only SELECT, WITH, or EXPLAIN query is allowed.");
  }

  return normalized;
}

export default defineTool({
  description: "Run one parameterized, read-only PostgreSQL query. Use $1, $2, and so on for values.",
  inputSchema,
  async execute({ query, values }) {
    const result = await getPool().query(assertReadOnlyQuery(query), values);
    return {
      rowCount: result.rowCount,
      rows: result.rows,
    };
  },
});