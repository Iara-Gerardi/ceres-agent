import { mkdir,mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../adapters/file-store.ts';
import { configSchema, type Document } from '../core/contracts.ts';
import { EventAnalytics } from '../adapters/analytics.ts';
import { Linkup } from '../adapters/linkup.ts';
import { AnalysisWorkflow } from '../core/workflow.ts';
import sample from '../config/sample.json' with {type:'json'};
import events from '../config/sample-events.json' with {type:'json'};

if(!process.env.LINKUP_API_KEY)throw new Error('Live research requires LINKUP_API_KEY');
const directory=await mkdtemp(join(tmpdir(),'ceres-live-'));const store=new FileStore(join(directory,'records.jsonl'));
try{
  const workflow=new AnalysisWorkflow(store,new EventAnalytics(async()=>events),new Linkup(process.env.LINKUP_API_KEY),configSchema.parse(sample));
  let state:any=await workflow.transition({action:'start',question:'Investigate whether search-intent mismatch or account-creation onboarding friction could explain the synthetic sample conversion weakness.',period:{start:'2026-09-07T00:00:00Z',end:'2026-09-10T12:00:00Z'},research:true});
  state=await workflow.transition({action:'submit_query',run_id:state.run_id,expected_version:state.state_version,query:'Find credible research about search-intent mismatch or account-creation onboarding friction affecting conversion. Return source URLs and supporting evidence.',reason:'The synthetic Search conversion observation does not identify a mechanism.',based_on_ids:[],uncertainties:['External evidence may not apply to this synthetic sample.']});
  if(state.phase==='findings_ready')state=await workflow.transition({action:'assess_findings',run_id:state.run_id,expected_version:state.state_version,assessments:state.findings.filter((finding:Document)=>finding.assessment_status==='pending').map((finding:Document)=>({finding_id:finding.id,relevant:true,summary:String(finding.content).slice(0,4000),uncertainty:'External context does not establish causality in the sample.',contradictions:[]}))});
  if(state.phase==='findings_assessed'){
    const source=state.findings.find((finding:Document)=>finding.relevant===true);
    state=await workflow.transition({action:'submit_query',run_id:state.run_id,expected_version:state.state_version,query:'Investigate the specific onboarding or intent mechanism described by the saved source. Find corroborating or conflicting evidence and return source URLs.',reason:'A saved finding identified a mechanism that needs a focused follow-up.',based_on_ids:[source.id],uncertainties:['Applicability to the sample remains uncertain.']});
    if(state.phase==='findings_ready')state=await workflow.transition({action:'assess_findings',run_id:state.run_id,expected_version:state.state_version,assessments:state.findings.filter((finding:Document)=>finding.assessment_status==='pending').map((finding:Document)=>({finding_id:finding.id,relevant:true,summary:String(finding.content).slice(0,4000),uncertainty:'External context does not establish causality in the sample.',contradictions:[]}))});
  }
  const relevant=state.findings.filter((finding:Document)=>finding.relevant===true);const sources=[state.analytics.id,...relevant.map((finding:Document)=>finding.id)];
  state=await workflow.transition({action:'submit_hypothesis',run_id:state.run_id,expected_version:state.state_version,...(state.stop_reason?{}:{stop_reason:'sufficient_evidence'}),hypothesis:{kind:'hypothesis',statement:'Search conversion may be affected by the mechanism described in the relevant external findings; the evidence is contextual and does not prove causality in this synthetic sample.',source_ids:sources,key_metrics:['Search/48h'],suggested_test:'Test a simplified account-creation step for eligible Search visitors and observe 48-hour conversion.',category:'conversion',uncertainties:['The sample is small and groups may overlap.']}});
  await mkdir('.eve/live-results',{recursive:true});await writeFile('.eve/live-results/result.json',JSON.stringify({result:state,records:await store.list()},null,2));
  if(state.phase!=='completed'||!state.hypothesis?.active||!state.findings.length){console.log(JSON.stringify({status:'incomplete',run_id:state.run_id}));process.exitCode=1;}
  else console.log(JSON.stringify({status:'pass',run_id:state.run_id,attempts:state.attempts,findings:state.findings.length,hypothesis:state.hypothesis.id,report:'.eve/live-results/result.json'}));
}finally{await rm(directory,{recursive:true,force:true});}
