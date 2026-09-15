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

The seed runs the actual analysis workflow using bundled synthetic events and a mock research provider. It needs no Linkup or model API key and makes no external research requests. Each invocation adds two completed mock runs: a partial, mixed-evidence run with an exploratory experiment and an inconclusive no-evidence run without a hypothesis. Existing records are preserved. If interrupted, partial records can remain; rerunning starts new runs.

Success prints `"status": "seeded"`, the database and schema names, a `run_id`, an `inconclusive_run_id`, counts for the primary run, and its revision count. The primary run contains six insights, one finding, two claims, two research gaps, one evidence assessment, one research assessment, one partial hypothesis, and one exploratory experiment. The second run demonstrates `complete_without_hypothesis`. Provider attempts are audit records; all research is mocked. Mock evidence is not proof of a real effect, and no external changes are made.

## Find the tables in pgAdmin

1. Connect to the server matching the host and port in `DATABASE_URL`. If it is not registered, right-click **Servers → Register → Server**. Give it a name; in **Connection**, enter the host, port, database (Maintenance database), username, and password from your connection settings.
2. Expand **Servers → your server → Databases → the database printed by the seed → Schemas → the schema printed by the seed → Tables**. The schema is normally `public`.
3. If the tables are missing, right-click **Tables → Refresh**.
4. Right-click **ceres_documents → View/Edit Data → All Rows** to view current records. `kind` distinguishes analytics, claims, gaps, findings, evidence assessments, hypotheses, conclusions, and experiments; there are no separate tables for those kinds. Their content is in the JSONB `snapshot` column.
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

Read the mock insight, claims, gaps, research, and hypothesis text:

```sql
SELECT id, kind, version,
       coalesce(snapshot->>'statement', snapshot->>'summary', snapshot->>'question') AS text,
       snapshot->>'url' AS source_url,
       snapshot->>'active' AS active,
       snapshot->>'trust' AS trust
FROM public.ceres_documents
WHERE run_id = 'PASTE_RUN_ID_HERE'::uuid
  AND kind IN ('insight', 'claim', 'research_gap', 'finding', 'evidence_assessment', 'research_assessment', 'hypothesis')
ORDER BY kind, id;
```

Confirm the workflow completed:

```sql
SELECT snapshot->>'status' AS status,
       snapshot->>'research_status' AS research_status,
       snapshot->'result_ids' AS result_ids
FROM public.ceres_documents
WHERE run_id = 'PASTE_RUN_ID_HERE'::uuid AND kind = 'run';
```

For the primary run this returns `status = completed`, `research_status = partial`, and saved claim, gap, evidence, finding, and hypothesis IDs. Query the printed `inconclusive_run_id` to inspect a completed run whose result has a conclusion ID and a null hypothesis ID.

Experiments are saved after analysis completes and link to the run and hypothesis:

```sql
SELECT id, snapshot->>'title' AS title,
       snapshot->>'hypothesis_id' AS hypothesis_id,
       snapshot->>'status' AS status,
       snapshot->>'execution_status' AS execution_status,
       snapshot->>'handoff' AS handoff,
       snapshot->'changes' AS changes,
       snapshot->'capability_check' AS capability_check
FROM public.ceres_documents
WHERE run_id = 'PASTE_RUN_ID_HERE'::uuid AND kind = 'experiment';
```
