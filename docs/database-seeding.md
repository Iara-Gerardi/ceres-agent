# Seed mock data and inspect it in pgAdmin

## Run the seed

Set `DATABASE_URL` in `.env.local` to an existing database, for example:

```dotenv
DATABASE_URL=postgresql://USERNAME:PASSWORD@localhost:5432/ceres
```

From the project root, run:

```sh
npm run db:migrate
npm run db:seed
```

The seed runs the actual analysis workflow using bundled synthetic events and a mock research provider. It needs no Linkup or model API key and makes no external research requests. Each invocation adds a new completed mock run, preserving existing records. It does not deduplicate previous seeds. If interrupted, partial records can remain; rerunning starts a new run.

Success prints `"status": "seeded"`, the database and schema names, a `run_id`, counts by kind, and the revision count. Copy that run ID to inspect just this seed. Expect six insights, one finding, one hypothesis, and supporting analytics, run, workflow state, research decision, provider attempt, and stop records. The provider attempt is a workflow audit record; the research call itself is mocked. Findings include both pending and assessed revisions in history. Validation scores and activation are calculated normally; mock evidence is not proof of a real effect.

## Find the tables in pgAdmin

1. Connect to the server matching the host and port in `DATABASE_URL`. If it is not registered, right-click **Servers → Register → Server**. Give it a name; in **Connection**, enter the host, port, database (Maintenance database), username, and password from your connection settings.
2. Expand **Servers → your server → Databases → the database printed by the seed → Schemas → the schema printed by the seed → Tables**. The schema is normally `public`.
3. If the tables are missing, right-click **Tables → Refresh**.
4. Right-click **ceres_documents → View/Edit Data → All Rows** to view current records. `kind` distinguishes `insight`, `finding`, and `hypothesis`; there are no separate tables for those kinds. Their content is in the JSONB `snapshot` column.
5. Open **ceres_document_revisions** the same way to inspect revision history. It contains more rows than the current-record table because findings, runs, and workflow state are revised.

pgAdmin documents the table context menu in its [View/Edit Data guide](https://www.pgadmin.org/docs/pgadmin4/latest/editgrid.html).

## Verify this seed with SQL

Select your database and open **Tools → Query Tool**. Replace `PASTE_RUN_ID_HERE` with the printed UUID before running each query. If the script printed a schema other than `public`, replace `public` too.

```sql
SELECT kind, count(*)
FROM public.ceres_documents
WHERE run_id = 'PASTE_RUN_ID_HERE'::uuid
GROUP BY kind
ORDER BY kind;
```

Read the mock insight, research, and hypothesis text:

```sql
SELECT id, kind, version,
       coalesce(snapshot->>'statement', snapshot->>'summary') AS text,
       snapshot->>'url' AS source_url,
       snapshot->>'active' AS active,
       snapshot->>'trust' AS trust
FROM public.ceres_documents
WHERE run_id = 'PASTE_RUN_ID_HERE'::uuid
  AND kind IN ('insight', 'finding', 'hypothesis')
ORDER BY kind, id;
```

Confirm the workflow completed:

```sql
SELECT snapshot->>'status' AS status, snapshot->'result_ids' AS result_ids
FROM public.ceres_documents
WHERE run_id = 'PASTE_RUN_ID_HERE'::uuid AND kind = 'run';
```

This should return one row with `status = completed` and saved insight, finding, and hypothesis IDs. If you see no rows, verify the selected database with `SELECT current_database(), current_schema();` and compare with the seed output. Check that the query uses the exact printed run ID. A missing-table error means the selected database/schema has not been migrated.
