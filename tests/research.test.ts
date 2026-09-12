import test from 'node:test';
import assert from 'node:assert/strict';
import { testStore } from './store.ts';
import { EventAnalytics, type Event } from '../adapters/analytics.ts';
import { Linkup } from '../adapters/linkup.ts';
import { AnalysisWorkflow } from '../core/workflow.ts';
import { configSchema, uuid7, type Document } from '../core/contracts.ts';
import events from '../config/sample-events.json' with {type:'json'};
import sample from '../config/sample.json' with {type:'json'};

const config=configSchema.parse(sample);
const period={start:'2026-09-07T00:00:00Z',end:'2026-09-10T12:00:00Z'};
const analytics=new EventAnalytics(async()=>events);
const startInput={action:'start' as const,question:'Research a conversion weakness and suggest a test',period,research:true};

test('conversion counts, configurable windows, duplicate events, immature cohorts and identity failures',async()=>{
  const result=await analytics.read(config,period);
  assert.deepEqual(result.metrics.map(m=>[m.numerator,m.denominator]),[[1,2],[2,2],[1,3],[2,3],[1,3],[2,3]]);
  const duplicated=await new EventAnalytics(async()=>[...events,...events]).read(config,period);
  assert.deepEqual(duplicated.metrics,result.metrics);
  const variant=structuredClone(config);variant.analytics.windows_hours=[1];
  assert.deepEqual((await analytics.read(variant,period)).metrics.filter(m=>m.metric.endsWith('1h')).map(m=>[m.numerator,m.denominator]),[[1,2],[1,3],[1,3]]);
  const immature:Event={visitor:'G',session:'g',group:'Search',event:'tab_visit',at:'2026-09-10T11:00:00Z'};
  const later=await new EventAnalytics(async()=>[...events,immature]).read(config,period);
  assert.equal(later.metrics.find(m=>m.metric==='Search/48h')!.denominator,3);
  variant.analytics.identity_linking=false;
  const incomplete=await analytics.read(variant,period);assert.equal(incomplete.metrics.length,3);assert.equal(incomplete.failures.length,3);
  const renamed=structuredClone(config);renamed.analytics.event='view';renamed.analytics.conversion='signup';renamed.analytics.groups=['Alpha','Beta','Gamma'];
  const mapped=events.map(e=>({...e,event:e.event==='tab_visit'?'view':'signup',group:e.group===null?null:renamed.analytics.groups[config.analytics.groups.indexOf(e.group)]!}));
  assert.deepEqual((await new EventAnalytics(async()=>mapped).read(renamed,period)).metrics.map(m=>[m.numerator,m.denominator]),result.metrics.map(m=>[m.numerator,m.denominator]));
});

test('state machine enforces ordering, versions, finding handoffs and grounded completion',async()=>{
  const d=await testStore();try{
    let calls=0;
    const provider={async search(){calls++;return calls===1
      ?[{name:'Relevant',url:'https://evidence.test/relevant',content:'Account creation friction can interrupt conversion.'},{name:'Unrelated',url:'https://evidence.test/unrelated',content:'Unrelated market commentary.'}]
      :[{name:'Follow-up',url:'https://evidence.test/follow-up',content:'Reducing fields can reduce onboarding friction.'}];}};
    let workflow=new AnalysisWorkflow(d.store,analytics,provider,config);
    const started:any=await workflow.transition(startInput);
    workflow=new AnalysisWorkflow(d.store,analytics,provider,config);
    assert.equal(started.phase,'analytics_ready');assert.deepEqual(started.next_actions,['submit_query']);assert.equal(started.state_version,1);
    await assert.rejects(workflow.transition({action:'assess_findings',run_id:started.run_id,expected_version:1,assessments:[{finding_id:started.analytics.id,relevant:true,summary:'x',uncertainty:'x',contradictions:[]}]}),/not allowed/);
    await assert.rejects(workflow.transition({action:'submit_query',run_id:started.run_id,expected_version:1,query:'initial',reason:'analytics gap',based_on_ids:[started.analytics.id],uncertainties:[]}),/initial query/);
    const researched:any=await workflow.transition({action:'submit_query',run_id:started.run_id,expected_version:1,query:'initial',reason:'analytics gap',based_on_ids:[],uncertainties:['Mechanism unknown.']});
    assert.equal(researched.phase,'findings_ready');assert.equal(researched.state_version,2);assert.equal(calls,1);
    await assert.rejects(workflow.transition({action:'submit_query',run_id:started.run_id,expected_version:1,query:'stale',reason:'stale',based_on_ids:[],uncertainties:[]}),/Stale workflow state/);
    await assert.rejects(workflow.transition({action:'submit_query',run_id:started.run_id,expected_version:2,query:'too soon',reason:'skip assessment',based_on_ids:[],uncertainties:[]}),/not allowed/);
    const [first,second]=researched.findings as Document[];
    await assert.rejects(workflow.transition({action:'assess_findings',run_id:started.run_id,expected_version:2,assessments:[{finding_id:first!.id,relevant:true,summary:'Relevant',uncertainty:'Context only',contradictions:[]}]}),/exactly once/);
    const assessed:any=await workflow.transition({action:'assess_findings',run_id:started.run_id,expected_version:2,assessments:[
      {finding_id:first!.id,relevant:true,summary:'Account creation friction may interrupt conversion.',uncertainty:'Context only',contradictions:['Intent may be an alternative.']},
      {finding_id:second!.id,relevant:false,summary:'Not relevant to the request.',uncertainty:'No applicable support',contradictions:[]},
    ]});
    assert.equal(assessed.phase,'findings_assessed');assert.deepEqual(assessed.next_actions,['submit_query']);
    await assert.rejects(workflow.transition({action:'submit_hypothesis',run_id:started.run_id,expected_version:3,stop_reason:'sufficient_evidence',hypothesis:{kind:'hypothesis',statement:'Too early',source_ids:[started.analytics.id,first!.id],key_metrics:['Search/48h'],suggested_test:'Test it',category:'conversion',uncertainties:[]}}),/requires one referenced follow-up/);
    await assert.rejects(workflow.transition({action:'submit_query',run_id:started.run_id,expected_version:3,query:'follow-up',reason:'detail',based_on_ids:[],uncertainties:[]}),/must reference/);
    await assert.rejects(workflow.transition({action:'submit_query',run_id:started.run_id,expected_version:3,query:'follow-up',reason:'detail',based_on_ids:[second!.id],uncertainties:[]}),/irrelevant finding/);
    const followed:any=await workflow.transition({action:'submit_query',run_id:started.run_id,expected_version:3,query:'follow-up',reason:'Investigate a saved mechanism',based_on_ids:[first!.id],uncertainties:[]});
    const latest=followed.findings.find((finding:Document)=>finding.assessment_status==='pending');
    const reassessed:any=await workflow.transition({action:'assess_findings',run_id:started.run_id,expected_version:4,assessments:[{finding_id:latest.id,relevant:true,summary:'Fewer fields may reduce friction.',uncertainty:'Applicability unproven',contradictions:[]}]});
    await assert.rejects(workflow.transition({action:'submit_hypothesis',run_id:started.run_id,expected_version:5,stop_reason:'sufficient_evidence',hypothesis:{kind:'hypothesis',statement:'Unsupported',source_ids:[started.analytics.id],key_metrics:['Search/48h'],suggested_test:'Test it',category:'conversion',uncertainties:[]}}),/relevant Linkup finding/);
    const completed:any=await workflow.transition({action:'submit_hypothesis',run_id:started.run_id,expected_version:5,stop_reason:'sufficient_evidence',hypothesis:{kind:'hypothesis',statement:'Account-creation friction may contribute to the observed conversion weakness; external evidence is contextual.',source_ids:[started.analytics.id,first!.id,latest.id],key_metrics:['Search/48h'],suggested_test:'Reduce required account fields and observe eligible visitor conversion at 48 hours.',category:'conversion',uncertainties:['Small overlapping groups do not establish causality.']}});
    assert.equal(completed.phase,'completed');assert.equal(completed.hypothesis.active,true);assert.deepEqual(completed.next_actions,[]);
    assert.deepEqual(await d.store.get(completed.hypothesis.id),completed.hypothesis);
    assert.equal((await d.store.list('insight')).length,started.insights.length);
    assert.equal((await d.store.history(first!.id)).length,2);
    assert.equal((await d.store.list('provider_attempt')).length,2);
    assert.equal((await d.store.list('run'))[0]!.status,'completed');
    await assert.rejects(workflow.transition({action:'submit_hypothesis',run_id:started.run_id,expected_version:6,stop_reason:'sufficient_evidence',hypothesis:{kind:'hypothesis',statement:'again',source_ids:[started.analytics.id,first!.id],key_metrics:['Search/48h'],suggested_test:'again',category:'conversion',uncertainties:[]}}),/not allowed/);
  }finally{await d.close();}
});

test('concurrent calls with one state version execute Linkup only once',async()=>{
  const d=await testStore();try{
    let calls=0;const workflow=new AnalysisWorkflow(d.store,analytics,{async search(){calls++;return [{name:'One',url:'https://evidence.test/one',content:'One'}];}},config);
    const started:any=await workflow.transition(startInput);
    const input={action:'submit_query' as const,run_id:started.run_id,expected_version:1,query:'one query',reason:'one reason',based_on_ids:[],uncertainties:[]};
    const outcomes=await Promise.allSettled([workflow.transition(input),workflow.transition({...input,query:'another query'})]);
    assert.equal(outcomes.filter(outcome=>outcome.status==='fulfilled').length,1);assert.equal(calls,1);
  }finally{await d.close();}
});

test('analytics-only, missing analytics, empty results and Linkup auth failure are explicit',async()=>{
  for(const mode of ['analytics-only','missing-data','empty','linkup-auth'] as const){
    const d=await testStore();try{
      let calls=0;const provider=mode==='linkup-auth'?new Linkup(''): {async search(){calls++;return [];}};
      const source=mode==='missing-data'?new EventAnalytics(async()=>[]):analytics;
      const workflow=new AnalysisWorkflow(d.store,source,provider,config);
      const started:any=await workflow.transition({...startInput,research:mode!=='analytics-only'});
      if(mode==='analytics-only'){assert.equal(started.phase,'completed');assert.equal(calls,0);assert.equal((await d.store.list('run'))[0]!.status,'completed');}
      if(mode==='missing-data'){assert.equal(started.status,'failed');assert.equal(calls,0);}
      if(mode==='empty'){
        const next:any=await workflow.transition({action:'submit_query',run_id:started.run_id,expected_version:1,query:'empty',reason:'test empty',based_on_ids:[],uncertainties:[]});
        assert.equal(next.phase,'ready_for_hypothesis');assert.equal(next.stop_reason,'empty_results');
      }
      if(mode==='linkup-auth'){
        const next:any=await workflow.transition({action:'submit_query',run_id:started.run_id,expected_version:1,query:'auth',reason:'test auth',based_on_ids:[],uncertainties:[]});
        assert.equal(next.stop_reason,'provider_error');const failure=(await d.store.list('failure')).find(record=>record.analysis==='linkup');assert.equal(failure?.reason,'linkup_authentication_failed');
      }
    }finally{await d.close();}
  }
});

test('Linkup adapter matches request contract and validates failures without leaking bodies',async()=>{
  const mock:typeof fetch=async(url,init)=>{
    assert.equal(url,'https://api.linkup.so/v1/search');assert.equal(init?.method,'POST');assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer private');
    const body=JSON.parse(String(init?.body));assert.equal(body.q,'test');assert.equal(body.depth,'standard');assert.equal(body.outputType,'searchResults');assert.equal(body.maxResults,5);
    return new Response(JSON.stringify({results:[{name:'Page',url:'https://example.test',content:'Retrieved excerpt'}]}));
  };
  assert.equal((await new Linkup('private',mock).search('test',5)).length,1);
  await assert.rejects(new Linkup('private',async()=>new Response('SECRET_CANARY',{status:429})).search('test',5),/status 429/);
  await assert.rejects(new Linkup('private',async()=>new Response('{}')).search('test',5));
  await assert.rejects(new Linkup('',mock).search('test',5),/credentials unavailable/);
});

test('hypothesis cannot cite evidence from another run',async()=>{
  const d=await testStore();try{
    const oneAttempt=structuredClone(config);oneAttempt.research.max_attempts=1;
    const workflow=new AnalysisWorkflow(d.store,analytics,{async search(){return [{name:'Relevant',url:'https://evidence.test/source',content:'Relevant'}];}},oneAttempt);
    const first:any=await workflow.transition({...startInput,research:false});
    let second:any=await workflow.transition(startInput);
    second=await workflow.transition({action:'submit_query',run_id:second.run_id,expected_version:1,query:'query',reason:'reason',based_on_ids:[],uncertainties:[]});
    const finding=second.findings[0];
    second=await workflow.transition({action:'assess_findings',run_id:second.run_id,expected_version:2,assessments:[{finding_id:finding.id,relevant:true,summary:'Relevant',uncertainty:'Context',contradictions:[]}]});
    await assert.rejects(workflow.transition({action:'submit_hypothesis',run_id:second.run_id,expected_version:3,hypothesis:{kind:'hypothesis',statement:'Cross-run citation',source_ids:[first.analytics.id,finding.id],key_metrics:['Search/48h'],suggested_test:'Test',category:'conversion',uncertainties:[]}}),/this run’s analytics/);
  }finally{await d.close();}
});
