import { EventAnalytics, SYNTHETIC_MOCK_ANALYTICS_SOURCE } from '../adapters/analytics.ts';
import { PostgresStore, createPostgresPool } from '../adapters/postgres-store.ts';
import { configSchema } from '../core/contracts.ts';
import { AnalysisWorkflow } from '../core/workflow.ts';
import { saveExperiment } from '../core/experiments.ts';
import config from '../config/sample.json' with {type:'json'};
import events from '../config/sample-events.json' with {type:'json'};

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in .env.local before seeding');
const pool = createPostgresPool(process.env.DATABASE_URL);
try {
  const store = new PostgresStore(pool);
  const workflow = new AnalysisWorkflow(store, new EventAnalytics(async()=>events,SYNTHETIC_MOCK_ANALYTICS_SOURCE), {
    async search() {
      return [{
        name:'MOCK: account creation friction study',
        url:'https://example.com/ceres-mock-research',
        content:'Synthetic seed evidence: participants in a fictional usability study hesitated when asked to complete a long account creation form. This is mock data, not a real study.',
      }];
    },
  }, configSchema.parse({...config, research:{...config.research,max_attempts:1}}));
  const requireState = (result: Awaited<ReturnType<AnalysisWorkflow['transition']>>) => {
    if (!('phase' in result)) throw new Error('Seed workflow failed');
    return result;
  };
  let state = requireState(await workflow.transition({
    action:'start', question:'MOCK SEED: investigate account creation friction in synthetic channel conversion data.',
    period:{start:'2026-09-07T00:00:00Z',end:'2026-09-10T12:00:00Z'}, research:true,
  }));
  const observation = state.insights.find(insight=>String(insight.statement).startsWith('Search/48h:'))!;
  state = requireState(await workflow.transition({
    action:'plan_research',run_id:state.run_id,expected_version:state.state_version,
    claims:[
      {key:'observation',statement:String(observation.statement),role:'observation',decisive:true,source_id:observation.id},
      {key:'friction',statement:'Long account-creation forms may introduce conversion friction.',role:'external_fact',decisive:true,source_id:null},
    ],
    gaps:[
      {key:'counterevidence',question:'What supports or limits the fictional form-friction explanation?',affected_claim_keys:['friction'],
        importance:'blocking',resolution_method:'web_search',purpose:'challenge',reason:'Seed a visible challenge and mixed-evidence path.'},
      {key:'product_state',question:'What fields are present in the actual form?',affected_claim_keys:['friction'],importance:'material',
        resolution_method:'product_inspection',purpose:'verify',reason:'External research cannot establish product state.'},
    ],
  }));
  const frictionClaim = state.claims.find(claim=>claim.key==='friction')!;
  const challengeGap = state.gaps.find(gap=>gap.key==='counterevidence')!;
  state = requireState(await workflow.transition({
    action:'submit_query',run_id:state.run_id,expected_version:state.state_version,
    query:'MOCK: account creation form friction',reason:'Explore a fictional explanation for the synthetic Search conversion observation.',
    based_on_ids:[],gap_ids:[challengeGap.id],uncertainties:['All seed evidence is synthetic.'],
  }));
  state = requireState(await workflow.transition({
    action:'assess_findings',run_id:state.run_id,expected_version:state.state_version,
    assessments:state.findings.map(finding=>({finding_id:finding.id,relevant:true,
      summary:'MOCK: the text suggests friction but explicitly cannot establish a real effect.',uncertainty:'Fictional evidence for development only.',
      contradictions:['The fictional observation does not establish causality or applicability.'],source_type:'primary_research' as const,
      publication_date:null,source_origin:'MOCK: fictional usability study',independence:'original' as const,
      evidence:[{claim_id:frictionClaim.id,verdict:'mixed' as const,passage:String(finding.content),fetched_document_id:null}]})),
    gap_resolutions:[{gap_id:challengeGap.id,status:'resolved',evidence_ids:state.findings.map(finding=>finding.id),
      reason:'The mock source contains both a suggested mechanism and an explicit limitation.'}],
  }));
  state = requireState(await workflow.transition({
    action:'submit_hypothesis',run_id:state.run_id,expected_version:state.state_version,
    hypothesis:{kind:'hypothesis',statement:'MOCK: reducing account creation form fields may improve Search conversion; the synthetic observations do not establish causality.',
      source_ids:[state.analytics.id,...state.findings.map(finding=>finding.id)],key_metrics:['Search/48h'],
      claim_ids:state.claims.map(claim=>claim.id),
      suggested_test:'MOCK: compare the existing form with a shorter form and measure eligible visitor conversion within 48 hours.',
      category:'conversion',uncertainties:['Small synthetic sample; fictional research.']},
  }));
  if (state.phase !== 'completed') throw new Error('Seed did not complete');
  if (!('hypothesis' in state) || !state.hypothesis) throw new Error('Seed hypothesis unavailable');
  await saveExperiment(store, {
    hypothesis_id:state.hypothesis.id,title:'MOCK: shorter account creation form',
    audience:'Synthetic Search visitors eligible for the 48-hour conversion metric',
    changes:[{target:'MOCK signup form',control:'Assumed existing form; verify its fields before implementation',
      treatment:'Defer optional fields until after account creation',reason:'Test the fictional form-friction hypothesis'}],
    primary_metric:'Search/48h',
    success_criterion:'Compare eligible visitor account creation within 48 hours between control and treatment; define sample size before launch.',
    guardrails:['Monitor account creation errors and downstream account quality'],
    uncertainties:['Synthetic demo only; actual form fields and traffic are not configured.'],
    intent:'exploratory',prerequisites:['Inspect and document the actual form fields before implementing a treatment.'],
    capability_check:{tool_name:null,reason:'The demo has no external action tool; these changes require manual implementation.'},
  });
  const inconclusiveWorkflow = new AnalysisWorkflow(store, new EventAnalytics(async()=>events,SYNTHETIC_MOCK_ANALYTICS_SOURCE), {async search(){return [];}},
    configSchema.parse({...config,research:{...config.research,max_attempts:1}}));
  let inconclusive = requireState(await inconclusiveWorkflow.transition({action:'start',
    question:'MOCK SEED: demonstrate an honest inconclusive result when no evidence is retrieved.',
    period:{start:'2026-09-07T00:00:00Z',end:'2026-09-10T12:00:00Z'},research:true}));
  const inconclusiveObservation = inconclusive.insights.find(insight=>String(insight.statement).startsWith('Search/48h:'))!;
  inconclusive = requireState(await inconclusiveWorkflow.transition({action:'plan_research',run_id:inconclusive.run_id,
    expected_version:inconclusive.state_version,claims:[
      {key:'observation',statement:String(inconclusiveObservation.statement),role:'observation',decisive:true,source_id:inconclusiveObservation.id},
      {key:'unknown_cause',statement:'A particular external mechanism explains the observation.',role:'inference',decisive:true,source_id:null},
    ],gaps:[{key:'challenge',question:'What evidence establishes or challenges a specific mechanism?',affected_claim_keys:['unknown_cause'],
      importance:'blocking',resolution_method:'web_search',purpose:'challenge',reason:'The cause is missing from the analytics.'}]}));
  inconclusive = requireState(await inconclusiveWorkflow.transition({action:'submit_query',run_id:inconclusive.run_id,
    expected_version:inconclusive.state_version,query:'MOCK: intentionally empty evidence query',reason:'Exercise the no-evidence path.',
    based_on_ids:[],gap_ids:[inconclusive.gaps[0]!.id],uncertainties:['No evidence is expected in this seed path.']}));
  inconclusive = requireState(await inconclusiveWorkflow.transition({action:'complete_without_hypothesis',run_id:inconclusive.run_id,
    expected_version:inconclusive.state_version,conclusion:{summary:'MOCK: no evidence was retrieved, so no causal hypothesis is asserted.',
      uncertainties:['The conversion mechanism remains unknown.']}}));
  if (inconclusive.phase !== 'completed' || inconclusive.conclusion?.research_status !== 'inconclusive') throw new Error('Inconclusive seed did not complete');
  const counts = await pool.query<{kind:string;count:number}>(
    'SELECT kind, count(*)::int AS count FROM ceres_documents WHERE run_id = $1 GROUP BY kind ORDER BY kind', [state.run_id],
  );
  const revisions = await pool.query<{count:number}>(
    "SELECT count(*)::int AS count FROM ceres_document_revisions WHERE snapshot->>'run_id' = $1", [state.run_id],
  );
  const location = await pool.query<{database:string;schema:string}>('SELECT current_database() AS database, current_schema() AS schema');
  console.log(JSON.stringify({status:'seeded',...location.rows[0],run_id:state.run_id,inconclusive_run_id:inconclusive.run_id,
    records:counts.rows,revisions:revisions.rows[0]!.count},null,2));
} catch {
  console.error('Ceres seed failed. Check DATABASE_URL, database connectivity, and run npm run db:migrate first. A failed run may leave partial mock records; rerunning creates a new run.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
