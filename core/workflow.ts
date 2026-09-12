import { z } from 'zod';
import { errorCategory } from './errors.ts';
import {
  candidateSchema, configSchema, findingAssessmentSchema, id, periodSchema, uuid7,
  type AnalyticsAdapter, type Document, type ProjectConfig, type ResearchAdapter, type Store,
} from './contracts.ts';
import { saveCandidate } from './validation.ts';

const analysisRequestSchema = z.object({
  question:z.string().min(1).max(4000), period:periodSchema, research:z.boolean().default(true),
}).strict();
const expectedStateSchema = {run_id:id,expected_version:z.number().int().positive()};
const chosenStopReasonSchema = z.enum(['sufficient_evidence','diminishing_value']);

export const workflowActionSchema = z.discriminatedUnion('action',[
  analysisRequestSchema.extend({action:z.literal('start')}),
  z.object({action:z.literal('submit_query'),...expectedStateSchema,query:z.string().trim().min(1).max(2000),reason:z.string().min(1).max(3000),based_on_ids:z.array(id).max(50),uncertainties:z.array(z.string().min(1).max(2000)).max(30).default([])}).strict(),
  z.object({action:z.literal('assess_findings'),...expectedStateSchema,assessments:z.array(findingAssessmentSchema).min(1).max(10)}).strict(),
  z.object({action:z.literal('submit_hypothesis'),...expectedStateSchema,stop_reason:chosenStopReasonSchema.optional(),hypothesis:candidateSchema.extend({kind:z.literal('hypothesis')})}).strict(),
]);

export type WorkflowAction = z.infer<typeof workflowActionSchema>;
type Phase = 'analytics_ready'|'findings_ready'|'findings_assessed'|'ready_for_hypothesis'|'completed';
type StopReason = z.infer<typeof chosenStopReasonSchema>|'analytics_only'|'budget_reached'|'empty_results'|'repeated_query'|'provider_error';
type StateFields = {
  phase:Phase; run_record_id:string; request:z.infer<typeof analysisRequestSchema>; analytics_id:string;
  insight_ids:string[]; finding_ids:string[]; pending_finding_ids:string[]; decision_ids:string[];
  attempts:number; queries:string[]; unresolved_questions:string[]; stop_reason:StopReason|null;
};
type WorkflowState = Document & StateFields;

const stateSchema = z.object({
  id,run_id:id,kind:z.literal('workflow_state'),version:z.number().int().positive(),created_at:z.iso.datetime(),updated_at:z.iso.datetime(),
  phase:z.enum(['analytics_ready','findings_ready','findings_assessed','ready_for_hypothesis','completed']),run_record_id:id,request:analysisRequestSchema,analytics_id:id,
  insight_ids:z.array(id),finding_ids:z.array(id),pending_finding_ids:z.array(id),decision_ids:z.array(id),attempts:z.number().int().nonnegative(),queries:z.array(z.string().min(1).max(2000)),
  unresolved_questions:z.array(z.string().min(1).max(2000)).max(100),stop_reason:z.enum(['sufficient_evidence','diminishing_value','analytics_only','budget_reached','empty_results','repeated_query','provider_error']).nullable(),
}).passthrough();

function stateBody(state:StateFields):Record<string,unknown> {
  return {phase:state.phase,run_record_id:state.run_record_id,request:state.request,analytics_id:state.analytics_id,insight_ids:state.insight_ids,finding_ids:state.finding_ids,pending_finding_ids:state.pending_finding_ids,decision_ids:state.decision_ids,attempts:state.attempts,queries:state.queries,unresolved_questions:state.unresolved_questions,stop_reason:state.stop_reason};
}

export class AnalysisWorkflow {
  private tail=Promise.resolve();
  constructor(private store:Store,private analytics:AnalyticsAdapter,private research:ResearchAdapter,private config:ProjectConfig,private now=()=>new Date()){configSchema.parse(config);}

  async transition(input:unknown){
    const action=workflowActionSchema.parse(input);
    return this.exclusive(()=>{
      if(action.action==='start')return this.start(action);
      if(action.action==='submit_query')return this.submitQuery(action);
      if(action.action==='assess_findings')return this.assessFindings(action);
      return this.submitHypothesis(action);
    });
  }

  private async exclusive<T>(work:()=>Promise<T>):Promise<T>{
    const previous=this.tail;let release!:()=>void;this.tail=new Promise<void>(resolve=>{release=resolve;});await previous;
    try{return await work();}finally{release();}
  }

  private async start(action:Extract<WorkflowAction,{action:'start'}>){
    const request=analysisRequestSchema.parse({question:action.question,period:action.period,research:action.research});
    const run=uuid7(this.now().getTime());let sequence=0;
    const record=(kind:string,body:Record<string,unknown>)=>this.store.save(run,kind,body,`${run}/start/${++sequence}`);
    const started=await record('run',{status:'running',request,config:this.config,workflow_version:'state-machine-v1'});
    try{
      const evidence=await this.analytics.read(this.config,request.period);const analytics=await record('analytics',evidence);
      for(const reason of evidence.failures)await record('failure',{analysis:reason,reason:'Affected analysis blocked; independent metrics may continue'});
      const insights:Document[]=[];
      for(const metric of evidence.metrics){
        const statement=`${metric.metric}: ${metric.numerator}/${metric.denominator} eligible visitors (${metric.value===null?'undefined rate':(metric.value*100).toFixed(2)+'%'}). Groups may overlap; this observation does not establish causality or superiority.`;
        insights.push(await saveCandidate(this.store,this.config,run,{kind:'insight',statement,source_ids:[analytics.id],key_metrics:[metric.metric],uncertainties:['Sample size and follow-up completeness limit interpretation.']},`${run}/insight/${metric.metric}`,this.now()));
      }
      const canResearch=request.research&&evidence.metrics.some(metric=>metric.value!==null);
      const phase:Phase=canResearch?(this.config.research.max_attempts===0?'ready_for_hypothesis':'analytics_ready'):'completed';
      const stopReason:StopReason|null=!request.research?'analytics_only':this.config.research.max_attempts===0?'budget_reached':null;
      const state=stateSchema.parse(await this.store.save(run,'workflow_state',stateBody({phase,run_record_id:started.id,request,analytics_id:analytics.id,insight_ids:insights.map(x=>x.id),finding_ids:[],pending_finding_ids:[],decision_ids:[],attempts:0,queries:[],unresolved_questions:[],stop_reason:stopReason}),`${run}/state/1`)) as WorkflowState;
      if(!canResearch){await record('research_stop',{reason:stopReason??'analytics_only',attempts:0,unresolved_questions:[]});await this.completeRun(state,null);}
      return this.view(state);
    }catch(error){
      await record('failure',{analysis:'analytics',reason:errorCategory(error)});
      await this.store.save(run,'run',{status:'failed',request,config:this.config,workflow_version:'state-machine-v1'},`${run}/failed`,{id:started.id,version:started.version});
      return {run_id:run,status:'failed',reason:errorCategory(error),next_actions:[]};
    }
  }

  private async submitQuery(action:Extract<WorkflowAction,{action:'submit_query'}>){
    const state=await this.loadState(action.run_id,action.expected_version);
    if(!['analytics_ready','findings_assessed'].includes(state.phase))throw new Error(`submit_query is not allowed during ${state.phase}`);
    if(state.attempts>=this.config.research.max_attempts)throw new Error('Research attempt budget exhausted');
    if(state.phase==='analytics_ready'&&action.based_on_ids.length)throw new Error('The initial query cannot reference findings');
    if(state.phase==='findings_assessed'&&!action.based_on_ids.length)throw new Error('A follow-up query must reference a relevant stored finding');
    const normalized=action.query.trim().toLowerCase();
    if(state.queries.some(query=>query.trim().toLowerCase()===normalized))throw new Error('Repeated research query');
    const relevant=await this.relevantFindings(state);
    if(action.based_on_ids.some(sourceId=>!relevant.some(finding=>finding.id===sourceId)))throw new Error('Query references an unknown or irrelevant finding');
    const attempt=state.attempts+1;
    const decision=await this.store.save(state.run_id,'research_decision',{action:'search',query:action.query,reason:action.reason,finding_ids:action.based_on_ids,uncertainties:action.uncertainties},`${state.run_id}/decision/${attempt}`);
    await this.store.save(state.run_id,'provider_attempt',{provider:'linkup',attempt,query:action.query,decision_id:decision.id,prior_finding_ids:action.based_on_ids},`${state.run_id}/provider/${attempt}`);
    let results;
    try{results=await this.research.search(action.query,this.config.research.max_results);}
    catch(error){
      const reason=errorCategory(error,'linkup');
      await this.store.save(state.run_id,'failure',{analysis:'linkup',reason,attempt},`${state.run_id}/linkup-failure/${attempt}`);
      const next=await this.reviseState(state,{phase:'ready_for_hypothesis',attempts:attempt,queries:[...state.queries,action.query],decision_ids:[...state.decision_ids,decision.id],unresolved_questions:this.unique([...state.unresolved_questions,...action.uncertainties,'Linkup retrieval failed.']),stop_reason:'provider_error'});
      return this.view(next);
    }
    const existing=await Promise.all(state.finding_ids.map(findingId=>this.store.get(findingId)));
    const freshResults=results.filter(result=>!existing.some(finding=>finding.url===result.url&&finding.content===result.content));const fresh:Document[]=[];
    for(const [index,result] of freshResults.entries())fresh.push(await this.store.save(state.run_id,'finding',{question:state.request.question,query:action.query,...result,retrieved_at:this.now().toISOString(),assessment_status:'pending',prior_finding_ids:action.based_on_ids,decision_id:decision.id},`${state.run_id}/finding/${attempt}/${index+1}`));
    const forcedStop:StopReason|null=fresh.length?null:(results.length?'diminishing_value':'empty_results');
    const next=await this.reviseState(state,{phase:fresh.length?'findings_ready':'ready_for_hypothesis',attempts:attempt,queries:[...state.queries,action.query],finding_ids:[...state.finding_ids,...fresh.map(finding=>finding.id)],pending_finding_ids:fresh.map(finding=>finding.id),decision_ids:[...state.decision_ids,decision.id],unresolved_questions:this.unique([...state.unresolved_questions,...action.uncertainties,...(fresh.length?[]:['No new supporting evidence was retrieved.'])]),stop_reason:forcedStop});
    return this.view(next);
  }

  private async assessFindings(action:Extract<WorkflowAction,{action:'assess_findings'}>){
    const state=await this.loadState(action.run_id,action.expected_version);
    if(state.phase!=='findings_ready')throw new Error(`assess_findings is not allowed during ${state.phase}`);
    const supplied=action.assessments.map(assessment=>assessment.finding_id);
    if(new Set(supplied).size!==supplied.length||supplied.length!==state.pending_finding_ids.length||supplied.some(findingId=>!state.pending_finding_ids.includes(findingId)))throw new Error('Assessments must cover every pending finding exactly once');
    for(const assessment of action.assessments){const finding=await this.store.get(assessment.finding_id);await this.store.save(state.run_id,'finding',{...finding,...assessment,assessment_status:'completed'},`${state.run_id}/assessment/${finding.id}`,{id:finding.id,version:finding.version});}
    const exhausted=state.attempts>=this.config.research.max_attempts;
    const next=await this.reviseState(state,{phase:exhausted?'ready_for_hypothesis':'findings_assessed',pending_finding_ids:[],unresolved_questions:this.unique([...state.unresolved_questions,...action.assessments.flatMap(assessment=>[assessment.uncertainty,...assessment.contradictions]).filter(Boolean)]),stop_reason:exhausted?'budget_reached':null});
    return this.view(next);
  }

  private async submitHypothesis(action:Extract<WorkflowAction,{action:'submit_hypothesis'}>){
    const state=await this.loadState(action.run_id,action.expected_version);
    if(!['findings_assessed','ready_for_hypothesis'].includes(state.phase))throw new Error(`submit_hypothesis is not allowed during ${state.phase}`);
    const assessedFindings=await this.relevantFindings(state);
    if(state.phase==='findings_assessed'&&state.attempts<Math.min(2,this.config.research.max_attempts)&&assessedFindings.length)throw new Error('A relevant initial finding requires one referenced follow-up query before hypothesis submission');
    const stopReason=state.stop_reason??action.stop_reason;if(!stopReason)throw new Error('A stop reason is required before submitting the hypothesis');
    if(state.stop_reason&&action.stop_reason&&action.stop_reason!==state.stop_reason)throw new Error('Stop reason conflicts with the enforced workflow outcome');
    const analytics=await this.store.get(state.analytics_id);const relevant=assessedFindings;const permitted=new Set([analytics.id,...relevant.map(finding=>finding.id)]);
    if(!action.hypothesis.source_ids.includes(analytics.id))throw new Error('Hypothesis must cite this run’s analytics');
    if(action.hypothesis.source_ids.some(sourceId=>!permitted.has(sourceId)))throw new Error('Hypothesis cites evidence that is unknown, irrelevant, or from another run');
    if(relevant.length&&!action.hypothesis.source_ids.some(sourceId=>relevant.some(finding=>finding.id===sourceId)))throw new Error('Hypothesis must cite at least one relevant Linkup finding');
    const hypothesisInput={...action.hypothesis,uncertainties:this.unique([...action.hypothesis.uncertainties,...state.unresolved_questions,...relevant.filter(finding=>action.hypothesis.source_ids.includes(finding.id)).flatMap(finding=>[String(finding.uncertainty??''),...(Array.isArray(finding.contradictions)?finding.contradictions.map(String):[])])]).slice(0,30)};
    const hypothesis=await saveCandidate(this.store,this.config,state.run_id,hypothesisInput,`${state.run_id}/hypothesis`,this.now());
    await this.store.save(state.run_id,'research_stop',{reason:stopReason,attempts:state.attempts,unresolved_questions:state.unresolved_questions},`${state.run_id}/research-stop`);
    await this.completeRun(state,hypothesis,stopReason);const completed=await this.reviseState(state,{phase:'completed',stop_reason:stopReason});return this.view(completed,hypothesis);
  }

  private async loadState(runId:string,expectedVersion:number):Promise<WorkflowState>{
    const matches=(await this.store.list('workflow_state')).filter(record=>record.run_id===runId);if(matches.length!==1)throw new Error('Workflow state unavailable');
    const state=stateSchema.parse(matches[0]) as WorkflowState;if(state.version!==expectedVersion)throw new Error(`Stale workflow state; expected version ${state.version}`);return state;
  }
  private async reviseState(state:WorkflowState,changes:Partial<WorkflowState>):Promise<WorkflowState>{const next={...state,...changes};return stateSchema.parse(await this.store.save(state.run_id,'workflow_state',stateBody(next),`${state.run_id}/state/${state.version+1}`,{id:state.id,version:state.version})) as WorkflowState;}
  private async relevantFindings(state:WorkflowState){const findings=await Promise.all(state.finding_ids.map(findingId=>this.store.get(findingId)));return findings.filter(finding=>finding.assessment_status==='completed'&&finding.relevant===true);}
  private async completeRun(state:WorkflowState,hypothesis:Document|null,stopReason:StopReason=state.stop_reason??'analytics_only'){
    const run=await this.store.get(state.run_record_id);return this.store.save(state.run_id,'run',{status:'completed',request:state.request,config:this.config,workflow_version:'state-machine-v1',result_ids:{insights:state.insight_ids,hypothesis:hypothesis?.id??null,findings:state.finding_ids,decisions:state.decision_ids},stop_reason:stopReason,attempts:state.attempts},`${state.run_id}/complete`,{id:run.id,version:run.version});
  }
  private async view(state:WorkflowState,hypothesis?:Document|null){
    const [analytics,insights,findings]=await Promise.all([this.store.get(state.analytics_id),Promise.all(state.insight_ids.map(recordId=>this.store.get(recordId))),Promise.all(state.finding_ids.map(recordId=>this.store.get(recordId)))]);
    const requiresFollowUp=state.phase==='findings_assessed'&&state.attempts<Math.min(2,this.config.research.max_attempts)&&findings.some(finding=>finding.assessment_status==='completed'&&finding.relevant===true);
    const next_actions=state.phase==='analytics_ready'?['submit_query']:state.phase==='findings_ready'?['assess_findings']:state.phase==='findings_assessed'?(requiresFollowUp?['submit_query']:['submit_query','submit_hypothesis']):state.phase==='ready_for_hypothesis'?['submit_hypothesis']:[];
    return {run_id:state.run_id,state_version:state.version,phase:state.phase,next_actions,attempts:state.attempts,max_attempts:this.config.research.max_attempts,stop_reason:state.stop_reason,unresolved_questions:state.unresolved_questions,analytics,insights,findings,...(hypothesis===undefined?{}:{hypothesis})};
  }
  private unique(values:string[]){return [...new Set(values.filter(Boolean))].slice(0,100);}
}
