import { defineDynamic, defineMcpClientConnection } from 'eve/connections';

const DEFAULT_MCP_URL = 'https://mcp.posthog.com/mcp';
const READ_ONLY_ANALYTICS_TOOLS = [
  'metric-list',
  'metric-describe',
  'data-catalog-metric-run',
  'read-data-schema',
  'execute-sql',
  'query-trends',
  'query-trends-actors',
  'query-funnel',
  'query-funnel-actors',
  'query-retention',
  'query-retention-actors',
  'query-paths',
  'query-paths-actors',
  'query-stickiness',
  'query-stickiness-actors',
  'query-lifecycle',
  'query-lifecycle-actors',
  'insight-get',
  'insight-query',
  'insights-list',
  'insights-trending-retrieve',
  'insights-activity-retrieve',
  'dashboard-get',
  'dashboards-get-all',
  'dashboard-insights-run',
] as const;

// The hosted MCP now multiplexes its operations through exec. Filter the
// inner operation as well: allowing exec alone would expose PostHog writes.
export function isReadOnlyPostHogCommand(command:unknown):boolean {
  if(typeof command!=='string')return false;
  const match=/^(tools|search|info|schema|call)(?:\s+([\s\S]*))?$/.exec(command.trim());
  if(!match)return false;
  const [,verb,rest='']=match;
  if(verb==='tools')return rest==='';
  if(verb==='search')return rest.length>0;
  const args=rest.replace(/^--json\s+/,'');
  const operation=args.split(/\s+/,1)[0];
  if(!(READ_ONLY_ANALYTICS_TOOLS as readonly string[]).includes(operation))return false;
  if(verb!=='call')return true;
  try {
    const input=JSON.parse(args.slice(operation.length).trim());
    return input!==null&&typeof input==='object'&&!Array.isArray(input);
  }catch{return false;}
}

function configuredValue(name:string) {
  const value=process.env[name]?.trim();
  return value ? value : undefined;
}

function configuredUrl() {
  const value=configuredValue('POSTHOG_MCP_URL') ?? DEFAULT_MCP_URL;
  const url=new URL(value);
  const local=['localhost','127.0.0.1','::1'].includes(url.hostname);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))throw new Error('POSTHOG_MCP_URL must use HTTPS, except for a loopback development server');
  return url.toString();
}

export function resolvePostHogConnection() {
  if(!configuredValue('POSTHOG_PERSONAL_API_KEY'))return null;
  const url=configuredUrl();
  const version=configuredValue('POSTHOG_MCP_VERSION') ?? '2';
  if(!/^\d+$/.test(version))throw new Error('POSTHOG_MCP_VERSION must be numeric');
  const project=configuredValue('POSTHOG_PROJECT_ID') ?? 'configured-project';
  return defineMcpClientConnection({
    url,
    description:'Live PostHog product analytics for Ceres. This connection is read-only and is never the built-in synthetic mock. Discover general analytics with the exact keywords "execute SQL events"; use "read data schema" when event or property names are unknown. The hosted server exposes exec: discover it with "exec", then use info/schema and call commands for read-only analytics. Exact query tool terms also include trends, funnels, retention, paths, stickiness, and lifecycle.',
    instanceKey:`${url}#${project}`,
    auth:{
      getToken:async()=>{
        const token=configuredValue('POSTHOG_PERSONAL_API_KEY');
        if(!token)throw new Error('PostHog MCP credentials are unavailable');
        return {token};
      },
    },
    headers:{'x-posthog-mcp-version':version},
    tools:{allow:['exec',...READ_ONLY_ANALYTICS_TOOLS]},
    approval:({toolName,toolInput})=>toolName==='posthog__exec'&&!isReadOnlyPostHogCommand(toolInput?.command)?'denied':'not-applicable',
  });
}

export default defineDynamic({
  events:{'session.started':()=>resolvePostHogConnection()},
});
