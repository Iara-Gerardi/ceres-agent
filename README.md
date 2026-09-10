# Ceres Agent

Minimal Eve agent with read-only PostgreSQL access, designed to self-host on Railway.

## Local setup

Install Node.js 24 or newer, then run:

```bash
npm install
cp .env.example .env
npm run dev
```

Set `AI_GATEWAY_API_KEY` and `DATABASE_URL` in `.env` before starting the agent.

## Railway deployment

1. Push this repository to GitHub and create a Railway service from it.
2. Add a PostgreSQL service to the same Railway project.
3. In the agent service, set `DATABASE_URL` to the PostgreSQL service's `DATABASE_URL` reference.
4. Add `AI_GATEWAY_API_KEY`, `ROUTE_AUTH_BASIC_USER`, and a strong `ROUTE_AUTH_BASIC_PASSWORD` to the agent service variables.
5. Attach a Railway volume to the agent service at `/app/.eve/.workflow-data` so Eve workflows survive redeployments.
6. Deploy. Railway uses `railway.json`, starts the Eve server on its assigned `PORT`, and checks `/eve/v1/health`.

The `query_database` tool accepts parameterized queries and enforces a read-only PostgreSQL connection. It only permits a single `SELECT`, `WITH`, or `EXPLAIN` statement.