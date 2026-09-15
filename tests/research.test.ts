import test from 'node:test';
import assert from 'node:assert/strict';
import { testStore } from './store.ts';
import { EventAnalytics, SYNTHETIC_MOCK_ANALYTICS_SOURCE, type Event } from '../adapters/analytics.ts';
import { Linkup } from '../adapters/linkup.ts';
import { AnalysisWorkflow } from '../core/workflow.ts';
import { configSchema, type Document } from '../core/contracts.ts';
import events from '../config/sample-events.json' with {type:'json'};
import sample from '../config/sample.json' with {type:'json'};

const config=configSchema.parse(sample);
const period={start:'2026-09-07T00:00:00Z',end:'2026-09-10T12:00:00Z'};
const analytics=new EventAnalytics(async()=>events,SYNTHETIC_MOCK_ANALYTICS_SOURCE);
const startInput={action:'start' as const,question:'Research a conversion weakness and suggest a test',period,research:true};

async function plan(workflow:AnalysisWorkflow,state:any){
  const observation=state.insights.find((item:Document)=>String(item.statement).startsWith('Search/48h:'));
  return workflow.transition({action:'plan_research',run_id:state.run_id,expected_version:state.state_version,claims:[
    {key:'search_observation',statement:observation.statement,role:'observation',decisive:true,source_id:observation.id},
    {key:'form_friction',statement:'Longer account-creation forms can interrupt conversion in some contexts.',role:'external_fact',decisive:true,source_id:null},
  ],gaps:[
    {key:'mechanism',question:'What evidence connects account-creation form length and conversion?',affected_claim_keys:['form_friction'],importance:'material',resolution_method:'web_search',purpose:'verify',reason:'Test the proposed mechanism.'},
    {key:'counterevidence',question:'What evidence contradicts or limits the form-friction explanation?',affected_claim_keys:['form_friction'],importance:'blocking',resolution_method:'web_search',purpose:'challenge',reason:'Check the preferred explanation.'},
    {key:'current_form',question:'What fields are on the current product form?',affected_claim_keys:['form_friction'],importance:'material',resolution_method:'product_inspection',purpose:'verify',reason:'External research cannot establish current product behavior.'},
  ]});
}

function assessment(finding:Document,claimId:string,passage:string,relevant=true,fetchedDocumentId:string|null=null){
  return {finding_id:finding.id,relevant,summary:relevant?'The source bears on form friction.':'The source is unrelated.',
    uncertainty:relevant?'Applicability to the synthetic sample is unknown.':'No applicable support.',contradictions:[],
    source_type:'primary_research' as const,publication_date:null,source_origin:String(finding.url),independence:'original' as const,
    evidence:relevant?[{claim_id:claimId,verdict:'supported' as const,passage,fetched_document_id:fetchedDocumentId}]:[]};
}

test('conversion counts, configurable windows, duplicate events, immature cohorts and identity failures',async()=>{
  const result=await analytics.read(config,period);
  assert.deepEqual(result.snapshot.source,SYNTHETIC_MOCK_ANALYTICS_SOURCE);
  assert.deepEqual(result.metrics.map(m=>[m.numerator,m.denominator]),[[1,2],[2,2],[1,3],[2,3],[1,3],[2,3]]);
  const duplicated=await new EventAnalytics(async()=>[...events,...events]).read(config,period);
  assert.deepEqual(duplicated.metrics,result.metrics);
  const variant=structuredClone(config);variant.analytics.windows_hours=[1];
  assert.deepEqual((await new EventAnalytics(async()=>events).read(variant,period)).metrics.filter(m=>m.metric.endsWith('1h')).map(m=>[m.numerator,m.denominator]),[[1,2],[1,3],[1,3]]);
  const immature:Event={visitor:'G',session:'g',group:'Search',event:'tab_visit',at:'2026-09-10T11:00:00Z'};
  const later=await new EventAnalytics(async()=>[...events,immature]).read(config,period);
  assert.equal(later.metrics.find(m=>m.metric==='Search/48h')!.denominator,3);
  variant.analytics.identity_linking=false;
  const incomplete=await analytics.read(variant,period);assert.equal(incomplete.metrics.length,3);assert.equal(incomplete.failures.length,3);
  const renamed=structuredClone(config);renamed.analytics.event='view';renamed.analytics.conversion='signup';renamed.analytics.groups=['Alpha','Beta','Gamma'];
  const mapped=events.map(e=>({...e,event:e.event==='tab_visit'?'view':'signup',group:e.group===null?null:renamed.analytics.groups[config.analytics.groups.indexOf(e.group)]!}));
  assert.deepEqual((await new EventAnalytics(async()=>mapped).read(renamed,period)).metrics.map(m=>[m.numerator,m.denominator]),result.metrics.map(m=>[m.numerator,m.denominator]));
});

test('state machine checks plans, exact evidence passages, counterevidence and sufficient completion',async()=>{
  const d=await testStore();try{
    let calls=0;const provider={async search(){calls++;return calls===1
      ?[{name:'Relevant',url:'https://evidence.test/relevant',content:'Account creation friction can interrupt conversion.'},{name:'Unrelated',url:'https://evidence.test/unrelated',content:'Unrelated market commentary.'}]
      :[{name:'Follow-up',url:'https://evidence.test/follow-up',content:'Reducing fields can reduce onboarding friction, although qualification may suffer.'}];}};
    let workflow=new AnalysisWorkflow(d.store,analytics,provider,config);
    const started:any=await workflow.transition(startInput);workflow=new AnalysisWorkflow(d.store,analytics,provider,config);
    assert.equal(started.phase,'research_planning');assert.deepEqual(started.next_actions,['plan_research']);
    await assert.rejects(workflow.transition({action:'submit_query',run_id:started.run_id,expected_version:started.state_version,query:'early',reason:'early',based_on_ids:[],gap_ids:[]}),/Invalid input|Too small/);
    const planned:any=await plan(workflow,started);assert.equal(planned.phase,'analytics_ready');
    const mechanism=planned.gaps.find((gap:Document)=>gap.key==='mechanism');const challenge=planned.gaps.find((gap:Document)=>gap.key==='counterevidence');
    const claim=planned.claims.find((item:Document)=>item.key==='form_friction');
    await assert.rejects(workflow.transition({action:'submit_query',run_id:planned.run_id,expected_version:planned.state_version,query:'initial',reason:'analytics gap',based_on_ids:[planned.analytics.id],gap_ids:[mechanism.id]}),/initial query/);
    const researched:any=await workflow.transition({action:'submit_query',run_id:planned.run_id,expected_version:planned.state_version,query:'initial',reason:'analytics gap',based_on_ids:[],gap_ids:[mechanism.id],uncertainties:['Mechanism unknown.']});
    assert.equal(researched.phase,'findings_ready');assert.equal(calls,1);
    const [first,second]=researched.findings as Document[];
    await assert.rejects(workflow.transition({action:'assess_findings',run_id:researched.run_id,expected_version:researched.state_version,
      assessments:[assessment(first!,claim.id,'Passage that is absent'),assessment(second!,claim.id,'',false)]}),/passage must appear verbatim/i);
    const assessed:any=await workflow.transition({action:'assess_findings',run_id:researched.run_id,expected_version:researched.state_version,assessments:[
      {...assessment(first!,claim.id,'Account creation friction can interrupt conversion.'),contradictions:['Intent may be an alternative.']},
      assessment(second!,claim.id,'',false),
    ],gap_resolutions:[{gap_id:mechanism.id,status:'resolved',evidence_ids:[first!.id],reason:'A source passage directly addresses the general mechanism.'}]});
    assert.deepEqual(assessed.next_actions,['submit_query']);assert.equal(assessed.research_assessment.status,'partial');
    await assert.rejects(workflow.transition({action:'submit_hypothesis',run_id:assessed.run_id,expected_version:assessed.state_version,stop_reason:'sufficient_evidence',hypothesis:{kind:'hypothesis',statement:'Too early',source_ids:[assessed.analytics.id,first!.id],claim_ids:assessed.claims.map((item:Document)=>item.id),key_metrics:['Search/48h'],suggested_test:'Test it',uncertainties:[]}}),/requires one referenced follow-up/);
    await assert.rejects(workflow.transition({action:'submit_query',run_id:assessed.run_id,expected_version:assessed.state_version,query:'follow-up',reason:'challenge',based_on_ids:[],gap_ids:[challenge.id],uncertainties:[]}),/must reference/);
    const followed:any=await workflow.transition({action:'submit_query',run_id:assessed.run_id,expected_version:assessed.state_version,query:'follow-up',reason:'Investigate counterevidence',based_on_ids:[first!.id],gap_ids:[challenge.id],uncertainties:[]});
    const latest=followed.findings.find((finding:Document)=>finding.assessment_status==='pending');
    const reassessed:any=await workflow.transition({action:'assess_findings',run_id:followed.run_id,expected_version:followed.state_version,
      assessments:[{...assessment(latest,claim.id,'Reducing fields can reduce onboarding friction, although qualification may suffer.'),contradictions:['Qualification may suffer.']}],
      gap_resolutions:[{gap_id:challenge.id,status:'resolved',evidence_ids:[latest.id],reason:'The source identifies both support and a material tradeoff.'}]});
    assert.equal(reassessed.research_assessment.status,'supported');
    await assert.rejects(workflow.transition({action:'submit_hypothesis',run_id:reassessed.run_id,expected_version:reassessed.state_version,stop_reason:'sufficient_evidence',hypothesis:{kind:'hypothesis',statement:'Unsupported citation set',source_ids:[reassessed.analytics.id],claim_ids:reassessed.claims.map((item:Document)=>item.id),key_metrics:['Search/48h'],suggested_test:'Test it',uncertainties:[]}}),/relevant Linkup finding/);
    const completed:any=await workflow.transition({action:'submit_hypothesis',run_id:reassessed.run_id,expected_version:reassessed.state_version,stop_reason:'sufficient_evidence',hypothesis:{kind:'hypothesis',statement:'Account-creation friction is worth an exploratory test; external evidence does not establish the sample cause.',source_ids:[reassessed.analytics.id,first!.id,latest.id],claim_ids:reassessed.claims.map((item:Document)=>item.id),key_metrics:['Search/48h'],suggested_test:'Inspect the form, then test fewer required fields for eligible Search visitors.',uncertainties:['Small overlapping groups do not establish causality.']}});
    assert.equal(completed.phase,'completed');assert.equal(completed.hypothesis.research_status,'supported');assert.equal(completed.hypothesis.active,true);
    assert.ok(completed.hypothesis.unresolved_gap_ids.includes(reassessed.gaps.find((gap:Document)=>gap.key==='current_form').id));
    assert.equal((await d.store.list('evidence_assessment')).length,2);assert.equal((await d.store.list('research_assessment')).length,1);
    assert.equal((await d.store.list('provider_attempt')).length,2);assert.equal((await d.store.list('run'))[0]!.research_status,'supported');
  }finally{await d.close();}
});

test('Fetch stores full text and only permits passages from the related source',async()=>{
  const d=await testStore();try{
    const provider={async search(){return [{name:'Snippet',url:'https://evidence.test/page',content:'Short snippet.'}];},
      async fetch(){return {markdown:'Full page evidence says shorter forms may reduce friction.'};}};
    const workflow=new AnalysisWorkflow(d.store,analytics,provider,config);let state:any=await workflow.transition(startInput);state=await plan(workflow,state);
    const gap=state.gaps.find((item:Document)=>item.key==='mechanism');const claim=state.claims.find((item:Document)=>item.key==='form_friction');
    state=await workflow.transition({action:'submit_query',run_id:state.run_id,expected_version:state.state_version,query:'source',reason:'Find source',based_on_ids:[],gap_ids:[gap.id]});
    assert.deepEqual(state.next_actions,['fetch_sources','assess_findings']);const finding=state.findings[0];
    state=await workflow.transition({action:'fetch_sources',run_id:state.run_id,expected_version:state.state_version,finding_ids:[finding.id]});
    const fetched=state.fetched_documents[0];assert.equal(fetched.finding_id,finding.id);
    state=await workflow.transition({action:'assess_findings',run_id:state.run_id,expected_version:state.state_version,
      assessments:[assessment(finding,claim.id,'Full page evidence says shorter forms may reduce friction.',true,fetched.id)],
      gap_resolutions:[{gap_id:gap.id,status:'resolved',evidence_ids:[fetched.id],reason:'Full text contains the supporting passage.'}]});
    assert.equal(state.evidence_assessments[0].source_id,fetched.id);assert.equal(state.fetches,1);
  }finally{await d.close();}
});

test('empty evidence can be reformulated and can complete inconclusively without a hypothesis',async()=>{
  const d=await testStore();try{
    const limited=configSchema.parse({...sample,research:{...sample.research,max_attempts:2}});let calls=0;
    const workflow=new AnalysisWorkflow(d.store,analytics,{async search(){calls++;return [];}},limited);
    let state:any=await workflow.transition(startInput);state=await plan(workflow,state);const gap=state.gaps.find((item:Document)=>item.key==='mechanism');
    state=await workflow.transition({action:'submit_query',run_id:state.run_id,expected_version:state.state_version,query:'first',reason:'Find evidence',based_on_ids:[],gap_ids:[gap.id]});
    assert.equal(state.phase,'findings_assessed');assert.ok(state.next_actions.includes('submit_query'));
    state=await workflow.transition({action:'submit_query',run_id:state.run_id,expected_version:state.state_version,query:'reformulated',reason:'Try adjacent terms',based_on_ids:[],gap_ids:[gap.id]});
    assert.equal(state.stop_reason,'empty_results');
    state=await workflow.transition({action:'complete_without_hypothesis',run_id:state.run_id,expected_version:state.state_version,
      conclusion:{summary:'No external evidence was found for the proposed explanation.',uncertainties:['The cause remains unknown.']}});
    assert.equal(state.phase,'completed');assert.equal(state.conclusion.research_status,'inconclusive');assert.equal(state.hypothesis,null);
    const run=(await d.store.list('run'))[0]!;assert.equal(run.research_status,'inconclusive');assert.equal((run.result_ids as any).hypothesis,null);assert.equal(calls,2);
  }finally{await d.close();}
});

test('concurrent calls with one state version execute Linkup only once',async()=>{
  const d=await testStore();try{
    let calls=0;const workflow=new AnalysisWorkflow(d.store,analytics,{async search(){calls++;return [{name:'One',url:'https://evidence.test/one',content:'One'}];}},config);
    let state:any=await workflow.transition(startInput);state=await plan(workflow,state);const gap=state.gaps[0];
    const input={action:'submit_query' as const,run_id:state.run_id,expected_version:state.state_version,query:'one query',reason:'one reason',based_on_ids:[],gap_ids:[gap.id],uncertainties:[]};
    const outcomes=await Promise.allSettled([workflow.transition(input),workflow.transition({...input,query:'another query'})]);
    assert.equal(outcomes.filter(outcome=>outcome.status==='fulfilled').length,1);assert.equal(calls,1);
  }finally{await d.close();}
});

test('analytics-only, missing analytics and Linkup auth failure are explicit',async()=>{
  for(const mode of ['analytics-only','missing-data','linkup-auth'] as const){
    const d=await testStore();try{
      let calls=0;const provider=mode==='linkup-auth'?new Linkup(''): {async search(){calls++;return [];}};
      const source=mode==='missing-data'?new EventAnalytics(async()=>[]):analytics;const workflow=new AnalysisWorkflow(d.store,source,provider,config);
      let state:any=await workflow.transition({...startInput,research:mode!=='analytics-only'});
      if(mode==='analytics-only'){assert.equal(state.phase,'completed');assert.equal(calls,0);const run=(await d.store.list('run'))[0]!;assert.equal(run.status,'completed');assert.equal(run.research_status,'not_requested');}
      if(mode==='missing-data'){assert.equal(state.status,'failed');assert.equal(calls,0);}
      if(mode==='linkup-auth'){
        state=await plan(workflow,state);const gap=state.gaps[0];state=await workflow.transition({action:'submit_query',run_id:state.run_id,expected_version:state.state_version,query:'auth',reason:'test auth',based_on_ids:[],gap_ids:[gap.id]});
        assert.equal(state.stop_reason,'provider_error');const failure=(await d.store.list('failure')).find(record=>record.analysis==='linkup');assert.equal(failure?.reason,'linkup_authentication_failed');
      }
    }finally{await d.close();}
  }
});

test('Linkup adapter matches Search and Fetch contracts and validates failures without leaking bodies',async()=>{
  const mock:typeof fetch=async(url,init)=>{
    assert.equal(init?.method,'POST');assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer private');const body=JSON.parse(String(init?.body));
    if(url==='https://api.linkup.so/v1/search'){
      assert.equal(body.outputType,'searchResults');assert.equal(body.maxResults,5);
      if(body.q==='test')assert.equal(body.depth,'standard');
      else {assert.equal(body.q,'filtered');assert.equal(body.depth,'deep');assert.deepEqual(body.includeDomains,['example.test']);assert.equal(body.fromDate,'2026-01-01');}
      return new Response(JSON.stringify({results:[{name:'Page',url:'https://example.test',content:'Retrieved excerpt'}]}));}
    assert.equal(url,'https://api.linkup.so/v1/fetch');assert.deepEqual(body,{url:'https://example.test',mode:'standard',renderJs:true});return new Response(JSON.stringify({markdown:'Full page'}));
  };
  const linkup=new Linkup('private',mock);assert.equal((await linkup.search('test',5)).length,1);
  assert.equal((await linkup.search('filtered',5,{depth:'deep',include_domains:['example.test'],exclude_domains:[],from_date:'2026-01-01',to_date:null})).length,1);
  assert.equal((await linkup.fetch('https://example.test')).markdown,'Full page');
  await assert.rejects(linkup.search('invalid filters',5,{depth:'standard',include_domains:['example.test'],exclude_domains:['EXAMPLE.test'],from_date:null,to_date:null}),/included and excluded/);
  await assert.rejects(new Linkup('private',async()=>new Response('SECRET_CANARY',{status:429})).search('test',5),/status 429/);
  await assert.rejects(new Linkup('private',async()=>new Response('{}')).search('test',5));await assert.rejects(new Linkup('',mock).search('test',5),/credentials unavailable/);
});

test('hypothesis cannot cite evidence from another run',async()=>{
  const d=await testStore();try{
    const limited=configSchema.parse({...sample,research:{...sample.research,max_attempts:1}});
    const workflow=new AnalysisWorkflow(d.store,analytics,{async search(){return [{name:'Relevant',url:'https://evidence.test/source',content:'Relevant evidence.'}];}},limited);
    const first:any=await workflow.transition({...startInput,research:false});let second:any=await workflow.transition(startInput);second=await plan(workflow,second);
    const gap=second.gaps[0];const claim=second.claims.find((item:Document)=>item.key==='form_friction');
    second=await workflow.transition({action:'submit_query',run_id:second.run_id,expected_version:second.state_version,query:'query',reason:'reason',based_on_ids:[],gap_ids:[gap.id]});const finding=second.findings[0];
    second=await workflow.transition({action:'assess_findings',run_id:second.run_id,expected_version:second.state_version,assessments:[assessment(finding,claim.id,'Relevant evidence.')],gap_resolutions:[]});
    await assert.rejects(workflow.transition({action:'submit_hypothesis',run_id:second.run_id,expected_version:second.state_version,hypothesis:{kind:'hypothesis',statement:'Cross-run citation',source_ids:[first.analytics.id,finding.id],claim_ids:second.claims.map((item:Document)=>item.id),key_metrics:['Search/48h'],suggested_test:'Test',uncertainties:[]}}),/this run’s analytics/);
  }finally{await d.close();}
});
