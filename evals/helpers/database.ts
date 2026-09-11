import { randomBytes } from "node:crypto";
import { Pool } from "pg";

export class DisposableDatabaseConfigurationError extends Error {}

function ident(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function assertSafeAdminUrl(raw: string): URL {
  const url = new URL(raw);
  if (!/^postgres(?:ql)?:$/.test(url.protocol)) {
    throw new DisposableDatabaseConfigurationError("EVAL_DATABASE_ADMIN_URL must use PostgreSQL");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const database = decodeURIComponent(url.pathname.slice(1)).toLowerCase();
  if (!local && !/(test|eval|ci|ephemeral|disposable)/.test(database)) {
    throw new DisposableDatabaseConfigurationError(
      "Remote admin URL database must be explicitly named test/eval/ci/ephemeral/disposable",
    );
  }
  return url;
}

export type DisposableDatabase = {
  databaseName: string;
  owner: Pool;
  analytics: Pool;
  admin: Pool;
  connectionStrings: { owner: string; analytics: string };
  destroy(): Promise<void>;
};

export async function createDisposableDatabase(explicitAdminUrl?: string): Promise<DisposableDatabase> {
  const raw = explicitAdminUrl ?? process.env.EVAL_DATABASE_ADMIN_URL;
  if (!raw) {
    throw new DisposableDatabaseConfigurationError(
      "Set EVAL_DATABASE_ADMIN_URL to an explicitly disposable PostgreSQL server; DATABASE_URL is never used",
    );
  }
  const adminUrl = assertSafeAdminUrl(raw);
  const suffix = randomBytes(8).toString("hex");
  const databaseName = `ceres_eval_${suffix}`;
  const ownerRole = `ceres_eval_owner_${suffix}`;
  const analyticsRole = `ceres_eval_analytics_${suffix}`;
  const ownerPassword = randomBytes(24).toString("base64url");
  const analyticsPassword = randomBytes(24).toString("base64url");
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  let owner: Pool | undefined;
  let analytics: Pool | undefined;

  try {
    await admin.query(`CREATE ROLE ${ident(ownerRole)} LOGIN PASSWORD '${ownerPassword}'`);
    await admin.query(`CREATE ROLE ${ident(analyticsRole)} LOGIN PASSWORD '${analyticsPassword}'`);
    await admin.query(`ALTER ROLE ${ident(analyticsRole)} SET default_transaction_read_only = on`);
    await admin.query(`CREATE DATABASE ${ident(databaseName)} OWNER ${ident(ownerRole)}`);

    const ownerUrl = new URL(adminUrl);
    ownerUrl.pathname = `/${databaseName}`;
    ownerUrl.username = ownerRole;
    ownerUrl.password = ownerPassword;
    const analyticsUrl = new URL(adminUrl);
    analyticsUrl.pathname = `/${databaseName}`;
    analyticsUrl.username = analyticsRole;
    analyticsUrl.password = analyticsPassword;
    owner = new Pool({ connectionString: ownerUrl.toString(), max: 2 });
    analytics = new Pool({ connectionString: analyticsUrl.toString(), max: 2 });

    await owner.query("CREATE TABLE analytics_fixture (id integer PRIMARY KEY, label text NOT NULL)");
    await owner.query("INSERT INTO analytics_fixture VALUES (1, 'unchanged')");
    await owner.query(`GRANT CONNECT ON DATABASE ${ident(databaseName)} TO ${ident(analyticsRole)}`);
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${ident(analyticsRole)}`);
    await owner.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ident(analyticsRole)}`);
    await owner.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(ownerRole)} IN SCHEMA public GRANT SELECT ON TABLES TO ${ident(analyticsRole)}`);

    return {
      databaseName,
      owner,
      analytics,
      admin,
      connectionStrings: { owner: ownerUrl.toString(), analytics: analyticsUrl.toString() },
      async destroy() {
        await Promise.allSettled([owner?.end(), analytics?.end()]);
        await admin.query(`DROP DATABASE IF EXISTS ${ident(databaseName)} WITH (FORCE)`);
        await admin.query(`DROP ROLE IF EXISTS ${ident(analyticsRole)}`);
        await admin.query(`DROP ROLE IF EXISTS ${ident(ownerRole)}`);
        await admin.end();
      },
    };
  } catch (error) {
    await Promise.allSettled([owner?.end(), analytics?.end()]);
    await admin.query(`DROP DATABASE IF EXISTS ${ident(databaseName)} WITH (FORCE)`).catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS ${ident(analyticsRole)}`).catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS ${ident(ownerRole)}`).catch(() => undefined);
    await admin.end().catch(() => undefined);
    throw error;
  }
}

