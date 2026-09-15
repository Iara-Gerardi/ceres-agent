import test from 'node:test';
import assert from 'node:assert/strict';
import { isReadOnlyPostHogCommand, resolvePostHogConnection } from '../agent/connections/posthog.ts';

const ENV_KEYS=['POSTHOG_PERSONAL_API_KEY','POSTHOG_MCP_URL','POSTHOG_MCP_VERSION','POSTHOG_PROJECT_ID'] as const;

test('PostHog MCP is optional, read-only, and does not leak its credential',async()=>{
  const previous=Object.fromEntries(ENV_KEYS.map(key=>[key,process.env[key]]));
  try{
    for(const key of ENV_KEYS)delete process.env[key];
    assert.equal(resolvePostHogConnection(),null);

    process.env.POSTHOG_PERSONAL_API_KEY='  phx_test_secret  ';
    process.env.POSTHOG_PROJECT_ID='project-42';
    const connection=resolvePostHogConnection();
    assert.ok(connection);
    assert.equal(connection.url,'https://mcp.posthog.com/mcp');
    assert.equal(connection.instanceKey,'https://mcp.posthog.com/mcp#project-42');
    assert.deepEqual(connection.headers,{'x-posthog-mcp-version':'2'});
    assert.ok(connection.tools&&'allow' in connection.tools);
    const allowed=[...connection.tools.allow] as string[];
    assert.ok(allowed.includes('query-funnel'));
    assert.ok(allowed.includes('execute-sql'));
    assert.ok(allowed.includes('exec'));
    assert.equal(typeof connection.approval,'function');
    const approve=connection.approval as (input:any)=>unknown;
    assert.equal(approve({toolName:'posthog__exec',toolInput:{command:'call execute-sql {"query":"SELECT 1"}'}}),'not-applicable');
    assert.equal(approve({toolName:'posthog__exec',toolInput:{command:'call insight-create {}'}}),'denied');
    assert.equal(approve({toolName:'posthog__exec'}),'denied');
    assert.equal(approve({toolName:'posthog__execute-sql',toolInput:{query:'SELECT 1'}}),'not-applicable');
    assert.equal(allowed.includes('experiment-create'),false);
    assert.equal(JSON.stringify(connection).includes('phx_test_secret'),false);
    assert.deepEqual(await (connection.auth as {getToken:()=>Promise<{token:string}>}).getToken(),{token:'phx_test_secret'});

    process.env.POSTHOG_MCP_URL='http://posthog.example.test/mcp';
    assert.throws(resolvePostHogConnection,/must use HTTPS/);
  }finally{
    for(const key of ENV_KEYS){
      const value=previous[key];
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});


test('PostHog exec permits analytics and rejects writes and malformed commands',()=>{
  for(const command of ['tools','search execute-sql','info read-data-schema','info --json execute-sql','schema query-trends series','call execute-sql {"query":"SELECT 1"}','call --json read-data-schema {"query":{"kind":"events"}}'])assert.equal(isReadOnlyPostHogCommand(command),true,command);
  for(const command of [null,'','tools extra','call insight-create {}','call dashboard-create {}','call --confirm insight-delete {}','call execute-sql null','call execute-sql []','call execute-sql {} trailing','call execute-sql {}\ncall insight-create {}','unknown execute-sql','call posthog:insight-create {}'])assert.equal(isReadOnlyPostHogCommand(command),false,String(command));
});
