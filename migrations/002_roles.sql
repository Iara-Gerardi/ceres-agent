-- Run as the Ceres database administrator after 001. These are privilege groups,
-- not login users. Grant them to separately provisioned runtime login roles.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='ceres_runtime') THEN CREATE ROLE ceres_runtime NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA ceres TO ceres_runtime;
GRANT SELECT ON ceres.workspaces TO ceres_runtime;
GRANT SELECT,INSERT,UPDATE ON ceres.documents TO ceres_runtime;
GRANT SELECT,INSERT ON ceres.history TO ceres_runtime;
-- No DELETE, DDL, owner, superuser or BYPASSRLS privileges for the runtime.
COMMIT;
