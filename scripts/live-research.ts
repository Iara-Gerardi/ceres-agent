import { mkdir,mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../adapters/file-store.ts';
import { configSchema, type Document } from '../core/contracts.ts';
import { EventAnalytics, SYNTHETIC_MOCK_ANALYTICS_SOURCE } from '../adapters/analytics.ts';
import { Linkup } from '../adapters/linkup.ts';
import { AnalysisWorkflow } from '../core/workflow.ts';
import sample from '../config/sample.json' with {type:'json'};
import events from '../config/sample-events.json' with {type:'json'};

if(!process.env.LINKUP_API_KEY)throw new Error('Live research requires LINKUP_API_KEY');
const directory=await mkdtemp(join(tmpdir(),'ceres-live-'));const store=new FileStore(join(directory,'records.jsonl'));
try{
  const workflow=new AnalysisWorkflow(store,new EventAnalytics(async()=>events,SYNTHETIC_MOCK_ANALYTICS_SOURCE),new Linkup(process.env.LINKUP_API_KEY),configSchema.parse(sample));
  let state:any=await workflow.transition({action:'start',question:'Investigate whether search-intent mismatch or account-creation onboarding friction could explain the synthetic sample conversion weakness.',period:{start:'2026-09-07T00:00:00Z',end:'2026-09-10T12:00:00Z'},research:true});
  const observation=state.insights.find((insight:Document)=>String(insight.statement).startsWith('Search/48h:'))!;
  state=await workflow.transition({action:'plan_research',run_id:state.run_id,expected_version:state.state_version,claims:[
    {key:'observation',statement:String(observation.statement),role:'observation',decisive:true,source_id:observation.id},
    {key:'mechanism',statement:'Search-intent mismatch or onboarding friction can affect conversion in some contexts.',role:'external_fact',decisive:true,source_id:null},
  ],gaps:[
    {key:'mechanism_evidence',question:'What credible evidence supports the proposed conversion mechanisms?',affected_claim_keys:['mechanism'],importance:'material',resolution_method:'web_search',purpose:'verify',reason:'The analytics do not identify a mechanism.'},
    {key:'counterevidence',question:'What evidence contradicts or limits the proposed mechanisms?',affected_claim_keys:['mechanism'],importance:'blocking',resolution_method:'web_search',purpose:'challenge',reason:'Challenge the preferred explanation.'},
    {key:'product_state',question:'What is the current account-creation flow?',affected_claim_keys:['mechanism'],importance:'material',resolution_method:'product_inspection',purpose:'verify',reason:'Web research cannot establish the sample product state.'},
  ]});
  const mechanismClaim=state.claims.find((claim:Document)=>claim.key==='mechanism');
  const assessPending=async(current:any,gap:Document)=>workflow.transition({action:'assess_findings',run_id:current.run_id,expected_version:current.state_version,
    assessments:current.findings.filter((finding:Document)=>finding.assessment_status==='pending').map((finding:Document)=>{
      const passage=String(finding.content).slice(0,4000);return {finding_id:finding.id,relevant:true,summary:passage||'The result contained no usable passage.',
        uncertainty:'External context does not establish causality in the sample.',contradictions:[],source_type:'unknown',publication_date:null,
        source_origin:String(finding.url),independence:'unknown',evidence:[{claim_id:mechanismClaim.id,
          verdict:passage?'supported':'insufficient_evidence',passage,fetched_document_id:null}]};}),
    gap_resolutions:[{gap_id:gap.id,status:'resolved',evidence_ids:current.findings.filter((finding:Document)=>finding.assessment_status==='pending').map((finding:Document)=>finding.id),reason:'The retrieved passages directly address the planned external claim; applicability remains uncertain.'}]});
  const mechanismGap=state.gaps.find((gap:Document)=>gap.key==='mechanism_evidence');
  state=await workflow.transition({action:'submit_query',run_id:state.run_id,expected_version:state.state_version,query:'Find credible research about search-intent mismatch or account-creation onboarding friction affecting conversion. Include limitations, populations, source URLs, and supporting passages.',reason:'The synthetic Search conversion observation does not identify a mechanism.',based_on_ids:[],gap_ids:[mechanismGap.id],uncertainties:['External evidence may not apply to this synthetic sample.']});
  if(state.phase==='findings_ready')state=await assessPending(state,mechanismGap);
  if(state.phase==='findings_assessed'){
    const source=state.findings.find((finding:Document)=>finding.relevant===true);
    const challengeGap=state.gaps.find((gap:Document)=>gap.key==='counterevidence');
    state=await workflow.transition({action:'submit_query',run_id:state.run_id,expected_version:state.state_version,query:'Find credible evidence that contradicts or limits claims that search-intent mismatch or shorter signup forms improve conversion. Include null results, population differences, tradeoffs, source URLs, and passages.',reason:'The proposed mechanism needs a counterevidence check.',based_on_ids:source?[source.id]:[],gap_ids:[challengeGap.id],uncertainties:['Applicability to the sample remains uncertain.']});
    if(state.phase==='findings_ready')state=await assessPending(state,challengeGap);
  }
  const relevant=state.findings.filter((finding:Document)=>finding.relevant===true);const sources=[state.analytics.id,...relevant.map((finding:Document)=>finding.id)];
  if(relevant.length)state=await workflow.transition({action:'submit_hypothesis',run_id:state.run_id,expected_version:state.state_version,...(state.stop_reason?{}:{stop_reason:state.research_assessment?.status==='supported'?'sufficient_evidence':'diminishing_value'}),hypothesis:{kind:'hypothesis',statement:'Search conversion may be affected by a mechanism described in the relevant external findings; this remains an exploratory explanation and does not establish causality in the synthetic sample.',source_ids:sources,claim_ids:state.claims.map((claim:Document)=>claim.id),key_metrics:['Search/48h'],suggested_test:'First inspect the actual flow, then test a justified account-creation change for eligible Search visitors and observe 48-hour conversion.',category:'conversion',uncertainties:['The sample is small and groups may overlap.']}});
  else state=await workflow.transition({action:'complete_without_hypothesis',run_id:state.run_id,expected_version:state.state_version,...(state.stop_reason?{}:{stop_reason:'diminishing_value'}),conclusion:{summary:'No relevant external finding was retrieved, so the run cannot identify a conversion mechanism.',uncertainties:['The sample is small, groups may overlap, and the product flow is unknown.']}});
  await mkdir('.eve/live-results',{recursive:true});await writeFile('.eve/live-results/result.json',JSON.stringify({result:state,records:await store.list()},null,2));
  if(state.phase!=='completed'){console.log(JSON.stringify({status:'incomplete',run_id:state.run_id}));process.exitCode=1;}
  else console.log(JSON.stringify({status:'pass',run_id:state.run_id,attempts:state.attempts,findings:state.findings.length,hypothesis:state.hypothesis?.id??null,conclusion:state.conclusion?.id??null,research_status:state.research_assessment?.status,report:'.eve/live-results/result.json'}));
}finally{await rm(directory,{recursive:true,force:true});}
