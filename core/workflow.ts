import { z } from 'zod';
import { errorCategory } from './errors.ts';
import {
  candidateSchema, claimPlanSchema, configSchema, findingAssessmentSchema, gapPlanSchema,
  gapResolutionSchema, id, periodSchema, researchSearchOptionsSchema, uuid7,
  type AnalyticsAdapter, type Document, type ProjectConfig, type ResearchAdapter, type Store,
} from './contracts.ts';
import { saveCandidate } from './validation.ts';

const analysisRequestSchema = z.object({
  question:z.string().min(1).max(4000), period:periodSchema, research:z.boolean().default(true),
}).strict();
const expectedStateSchema = {run_id:id,expected_version:z.number().int().positive()};
const chosenStopReasonSchema = z.enum(['sufficient_evidence','diminishing_value']);
const conclusionSchema = z.object({
  summary:z.string().trim().min(1).max(6000), uncertainties:z.array(z.string().trim().min(1).max(2000)).max(300),
}).strict();

export const workflowActionSchema = z.discriminatedUnion('action',[
  analysisRequestSchema.extend({action:z.literal('start')}),
  z.object({action:z.literal('plan_research'),...expectedStateSchema,
    claims:z.array(claimPlanSchema).min(1).max(50),gaps:z.array(gapPlanSchema).min(1).max(50)}).strict(),
  z.object({action:z.literal('submit_query'),...expectedStateSchema,query:z.string().trim().min(1).max(2000),
    reason:z.string().min(1).max(3000),based_on_ids:z.array(id).max(50),gap_ids:z.array(id).min(1).max(50),
    uncertainties:z.array(z.string().min(1).max(2000)).max(30).default([]),search_options:researchSearchOptionsSchema.optional()}).strict(),
  z.object({action:z.literal('fetch_sources'),...expectedStateSchema,finding_ids:z.array(id).min(1).max(10)}).strict(),
  z.object({action:z.literal('assess_findings'),...expectedStateSchema,
    assessments:z.array(findingAssessmentSchema).min(1).max(10),gap_resolutions:z.array(gapResolutionSchema).max(50).default([])}).strict(),
  z.object({action:z.literal('submit_hypothesis'),...expectedStateSchema,stop_reason:chosenStopReasonSchema.optional(),
    hypothesis:candidateSchema.extend({kind:z.literal('hypothesis')})}).strict(),
  z.object({action:z.literal('complete_without_hypothesis'),...expectedStateSchema,
    stop_reason:z.literal('diminishing_value').optional(),conclusion:conclusionSchema}).strict(),
]);

export type WorkflowAction = z.infer<typeof workflowActionSchema>;
type Phase = 'research_planning'|'analytics_ready'|'findings_ready'|'findings_assessed'|'ready_for_hypothesis'|'completed';
type StopReason = z.infer<typeof chosenStopReasonSchema>|'analytics_only'|'budget_reached'|'empty_results'|'repeated_query'|'provider_error';
type ResearchStatus = 'supported'|'partial'|'inconclusive'|'not_requested';
type StateFields = {
  phase:Phase; run_record_id:string; request:z.infer<typeof analysisRequestSchema>; analytics_id:string;
  insight_ids:string[]; claim_ids:string[]; gap_ids:string[]; finding_ids:string[]; pending_finding_ids:string[];
  fetched_document_ids:string[]; evidence_assessment_ids:string[]; decision_ids:string[]; conclusion_id:string|null;
  attempts:number; fetches:number; queries:string[]; unresolved_questions:string[]; stop_reason:StopReason|null;
};
type WorkflowState = Document & StateFields;

const stateSchema = z.object({
  id,run_id:id,kind:z.literal('workflow_state'),version:z.number().int().positive(),created_at:z.iso.datetime(),updated_at:z.iso.datetime(),
  phase:z.enum(['research_planning','analytics_ready','findings_ready','findings_assessed','ready_for_hypothesis','completed']),
  run_record_id:id,request:analysisRequestSchema,analytics_id:id,insight_ids:z.array(id),claim_ids:z.array(id).default([]),
  gap_ids:z.array(id).default([]),finding_ids:z.array(id),pending_finding_ids:z.array(id),fetched_document_ids:z.array(id).default([]),
  evidence_assessment_ids:z.array(id).default([]),decision_ids:z.array(id),conclusion_id:id.nullable().default(null),
  attempts:z.number().int().nonnegative(),fetches:z.number().int().nonnegative().default(0),queries:z.array(z.string().min(1).max(2000)),
  unresolved_questions:z.array(z.string().min(1).max(2000)).max(300),
  stop_reason:z.enum(['sufficient_evidence','diminishing_value','analytics_only','budget_reached','empty_results','repeated_query','provider_error']).nullable(),
}).passthrough();

function stateBody(state:StateFields):Record<string,unknown> {
  return {phase:state.phase,run_record_id:state.run_record_id,request:state.request,analytics_id:state.analytics_id,
    insight_ids:state.insight_ids,claim_ids:state.claim_ids,gap_ids:state.gap_ids,finding_ids:state.finding_ids,
    pending_finding_ids:state.pending_finding_ids,fetched_document_ids:state.fetched_document_ids,
    evidence_assessment_ids:state.evidence_assessment_ids,decision_ids:state.decision_ids,conclusion_id:state.conclusion_id,
    attempts:state.attempts,fetches:state.fetches,queries:state.queries,unresolved_questions:state.unresolved_questions,
    stop_reason:state.stop_reason};
}

export class AnalysisWorkflow {
  private tail=Promise.resolve();
  constructor(private store:Store,private analytics:AnalyticsAdapter,private research:ResearchAdapter,private config:ProjectConfig,private now=()=>new Date()){this.config=configSchema.parse(config);}

  async transition(input:unknown){
    const action=workflowActionSchema.parse(input);
    return this.exclusive(()=>{
      if(action.action==='start')return this.start(action);
      if(action.action==='plan_research')return this.planResearch(action);
      if(action.action==='submit_query')return this.submitQuery(action);
      if(action.action==='fetch_sources')return this.fetchSources(action);
      if(action.action==='assess_findings')return this.assessFindings(action);
      if(action.action==='complete_without_hypothesis')return this.completeWithoutHypothesis(action);
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
    const started=await record('run',{status:'running',request,config:this.config,workflow_version:'state-machine-v2'});
    try{
      const evidence=await this.analytics.read(this.config,request.period);const analytics=await record('analytics',evidence);
      for(const reason of evidence.failures)await record('failure',{analysis:reason,reason:'Affected analysis blocked; independent metrics may continue'});
      const insights:Document[]=[];
      for(const metric of evidence.metrics){
        const statement=`${metric.metric}: ${metric.numerator}/${metric.denominator} eligible visitors (${metric.value===null?'undefined rate':(metric.value*100).toFixed(2)+'%'}). Groups may overlap; this observation does not establish causality or superiority.`;
        insights.push(await saveCandidate(this.store,this.config,run,{kind:'insight',statement,source_ids:[analytics.id],key_metrics:[metric.metric],uncertainties:['Sample size and follow-up completeness limit interpretation.']},`${run}/insight/${metric.metric}`,this.now()));
      }
      const canResearch=request.research&&evidence.metrics.some(metric=>metric.value!==null);
      const phase:Phase=canResearch?(this.config.research.max_attempts===0?'ready_for_hypothesis':'research_planning'):'completed';
      const stopReason:StopReason|null=!request.research?'analytics_only':this.config.research.max_attempts===0?'budget_reached':null;
      const state=stateSchema.parse(await this.store.save(run,'workflow_state',stateBody({phase,run_record_id:started.id,request,
        analytics_id:analytics.id,insight_ids:insights.map(x=>x.id),claim_ids:[],gap_ids:[],finding_ids:[],pending_finding_ids:[],
        fetched_document_ids:[],evidence_assessment_ids:[],decision_ids:[],conclusion_id:null,attempts:0,fetches:0,queries:[],
        unresolved_questions:[],stop_reason:stopReason}),`${run}/state/1`)) as WorkflowState;
      if(!canResearch){await record('research_stop',{reason:stopReason??'analytics_only',attempts:0,unresolved_questions:[]});await this.completeRun(state,{hypothesis:null,conclusion:null},stopReason??'analytics_only',request.research?'inconclusive':'not_requested');}
      return this.view(state);
    }catch(error){
      await record('failure',{analysis:'analytics',reason:errorCategory(error)});
      await this.store.save(run,'run',{status:'failed',request,config:this.config,workflow_version:'state-machine-v2'},`${run}/failed`,{id:started.id,version:started.version});
      return {run_id:run,status:'failed',reason:errorCategory(error),next_actions:[]};
    }
  }

  private async planResearch(action:Extract<WorkflowAction,{action:'plan_research'}>){
    const state=await this.loadState(action.run_id,action.expected_version);
    if(state.phase!=='research_planning'&&!(state.phase==='analytics_ready'&&!state.claim_ids.length&&!state.gap_ids.length))throw new Error(`plan_research is not allowed during ${state.phase}`);
    const claimKeys=action.claims.map(claim=>claim.key);const gapKeys=action.gaps.map(gap=>gap.key);
    if(new Set(claimKeys).size!==claimKeys.length||new Set(gapKeys).size!==gapKeys.length)throw new Error('Research plan keys must be unique');
    if(action.gaps.some(gap=>gap.affected_claim_keys.some(key=>!claimKeys.includes(key))))throw new Error('A gap references an unknown claim key');
    if(!action.claims.some(claim=>claim.decisive&&claim.role!=='observation'))throw new Error('Research plan requires a decisive claim beyond the analytics observation');
    if(!action.gaps.some(gap=>gap.purpose==='challenge'&&gap.resolution_method==='web_search'))throw new Error('Research plan requires a web-search challenge gap');
    const insights=await Promise.all(state.insight_ids.map(insightId=>this.store.get(insightId)));
    if(action.claims.some(claim=>claim.role==='observation'&&!insights.some(insight=>insight.id===claim.source_id&&insight.statement===claim.statement)))throw new Error('Observation claim must exactly match and cite this run’s saved insight');
    const decisiveResearchKeys=new Set(action.claims.filter(claim=>claim.decisive&&claim.role!=='observation').map(claim=>claim.key));
    if(!action.gaps.some(gap=>gap.purpose==='challenge'&&gap.affected_claim_keys.some(key=>decisiveResearchKeys.has(key))))throw new Error('Challenge gap must affect a decisive research claim');
    const claims:Document[]=[];
    for(const [index,claim] of action.claims.entries())claims.push(await this.store.save(state.run_id,'claim',{
      ...claim,evidence_status:claim.role==='observation'?'supported':'not_checked',
      evidence_assessment_ids:[],source_ids:claim.source_id?[claim.source_id]:[],policy_version:'evidence-review-v1',
    },`${state.run_id}/claim/${index+1}`));
    const byKey=new Map(claims.map(claim=>[String(claim.key),claim.id]));const gaps:Document[]=[];
    for(const [index,gap] of action.gaps.entries())gaps.push(await this.store.save(state.run_id,'research_gap',{
      ...gap,affected_claim_ids:gap.affected_claim_keys.map(key=>byKey.get(key)!),status:'open',evidence_ids:[],
      search_attempts:0,resolution_reason:null,policy_version:'evidence-review-v1',
    },`${state.run_id}/gap/${index+1}`));
    const next=await this.reviseState(state,{phase:'analytics_ready',claim_ids:claims.map(claim=>claim.id),gap_ids:gaps.map(gap=>gap.id)});
    return this.view(next);
  }

  private async submitQuery(action:Extract<WorkflowAction,{action:'submit_query'}>){
    const state=await this.loadState(action.run_id,action.expected_version);
    if(!['analytics_ready','findings_assessed'].includes(state.phase))throw new Error(`submit_query is not allowed during ${state.phase}`);
    if(state.attempts>=this.config.research.max_attempts)throw new Error('Research attempt budget exhausted');
    if(state.phase==='analytics_ready'&&action.based_on_ids.length)throw new Error('The initial query cannot reference findings');
    const relevant=await this.relevantFindings(state);
    if(state.phase==='findings_assessed'&&relevant.length&&!action.based_on_ids.length)throw new Error('A follow-up query must reference a relevant stored finding');
    if(action.based_on_ids.some(sourceId=>!relevant.some(finding=>finding.id===sourceId)))throw new Error('Query references an unknown or irrelevant finding');
    const gaps=await Promise.all(state.gap_ids.map(gapId=>this.store.get(gapId)));
    const selectedGaps=gaps.filter(gap=>action.gap_ids.includes(gap.id));
    if(selectedGaps.length!==action.gap_ids.length||selectedGaps.some(gap=>gap.status!=='open'||gap.resolution_method!=='web_search'))throw new Error('Query must reference open web-search gaps from this run');
    const normalized=action.query.trim().toLowerCase();
    if(state.queries.some(query=>query.trim().toLowerCase()===normalized))throw new Error('Repeated research query');
    const attempt=state.attempts+1;const searchOptions=researchSearchOptionsSchema.parse(action.search_options??{});
    const decision=await this.store.save(state.run_id,'research_decision',{action:'search',query:action.query,reason:action.reason,
      finding_ids:action.based_on_ids,gap_ids:action.gap_ids,search_options:searchOptions,uncertainties:action.uncertainties},`${state.run_id}/decision/${attempt}`);
    for(const gap of selectedGaps)await this.store.save(state.run_id,'research_gap',{...gap,search_attempts:Number(gap.search_attempts??0)+1,
      last_query:action.query,last_decision_id:decision.id},`${state.run_id}/gap-search/${gap.id}/${attempt}`,{id:gap.id,version:gap.version});
    await this.store.save(state.run_id,'provider_attempt',{provider:'linkup',operation:'search',attempt,query:action.query,
      decision_id:decision.id,prior_finding_ids:action.based_on_ids,gap_ids:action.gap_ids,search_options:searchOptions},`${state.run_id}/provider/search/${attempt}`);
    let results;
    try{results=await this.research.search(action.query,this.config.research.max_results,searchOptions);}
    catch(error){
      const reason=errorCategory(error,'linkup');
      await this.store.save(state.run_id,'failure',{analysis:'linkup',operation:'search',reason,attempt},`${state.run_id}/linkup-failure/search/${attempt}`);
      const next=await this.reviseState(state,{phase:'ready_for_hypothesis',attempts:attempt,queries:[...state.queries,action.query],
        decision_ids:[...state.decision_ids,decision.id],unresolved_questions:this.unique([...state.unresolved_questions,...action.uncertainties,'Linkup retrieval failed.']),stop_reason:'provider_error'});
      return this.view(next);
    }
    const existing=await Promise.all(state.finding_ids.map(findingId=>this.store.get(findingId)));
    const freshResults=results.filter(result=>!existing.some(finding=>finding.url===result.url&&finding.content===result.content));const fresh:Document[]=[];
    for(const [index,result] of freshResults.entries())fresh.push(await this.store.save(state.run_id,'finding',{question:state.request.question,
      query:action.query,...result,retrieved_at:this.now().toISOString(),assessment_status:'pending',prior_finding_ids:action.based_on_ids,
      gap_ids:action.gap_ids,decision_id:decision.id},`${state.run_id}/finding/${attempt}/${index+1}`));
    const exhausted=attempt>=this.config.research.max_attempts;
    const forcedStop:StopReason|null=!fresh.length&&exhausted?(results.length?'diminishing_value':'empty_results'):null;
    const phase:Phase=fresh.length?'findings_ready':exhausted?'ready_for_hypothesis':'findings_assessed';
    const next=await this.reviseState(state,{phase,attempts:attempt,queries:[...state.queries,action.query],
      finding_ids:[...state.finding_ids,...fresh.map(finding=>finding.id)],pending_finding_ids:fresh.map(finding=>finding.id),
      decision_ids:[...state.decision_ids,decision.id],unresolved_questions:this.unique([...state.unresolved_questions,...action.uncertainties,
        ...(fresh.length?[]:['No new supporting evidence was retrieved.'])]),stop_reason:forcedStop});
    return this.view(next);
  }

  private async fetchSources(action:Extract<WorkflowAction,{action:'fetch_sources'}>){
    const state=await this.loadState(action.run_id,action.expected_version);
    if(state.phase!=='findings_ready')throw new Error(`fetch_sources is not allowed during ${state.phase}`);
    if(!this.research.fetch)throw new Error('Research adapter does not support Fetch');
    if(state.fetches+action.finding_ids.length>this.config.research.max_fetches)throw new Error('Fetch budget exhausted');
    if(new Set(action.finding_ids).size!==action.finding_ids.length||action.finding_ids.some(findingId=>!state.pending_finding_ids.includes(findingId)))throw new Error('Fetch requires unique pending findings');
    const prior=await Promise.all(state.fetched_document_ids.map(documentId=>this.store.get(documentId)));
    if(action.finding_ids.some(findingId=>prior.some(document=>document.finding_id===findingId)))throw new Error('Finding already fetched');
    const documents:Document[]=[];let fetches=state.fetches;
    for(const findingId of action.finding_ids){
      const finding=await this.store.get(findingId);fetches++;
      await this.store.save(state.run_id,'provider_attempt',{provider:'linkup',operation:'fetch',attempt:fetches,url:finding.url,
        finding_id:finding.id},`${state.run_id}/provider/fetch/${fetches}`);
      try{
        const result=await this.research.fetch(String(finding.url));
        documents.push(await this.store.save(state.run_id,'fetched_document',{finding_id:finding.id,url:finding.url,
          markdown:result.markdown,retrieved_at:this.now().toISOString()},`${state.run_id}/fetch/${fetches}`));
      }catch(error){
        await this.store.save(state.run_id,'failure',{analysis:'linkup',operation:'fetch',reason:errorCategory(error,'linkup'),
          attempt:fetches,finding_id:finding.id},`${state.run_id}/linkup-failure/fetch/${fetches}`);
      }
    }
    const next=await this.reviseState(state,{fetches,fetched_document_ids:[...state.fetched_document_ids,...documents.map(document=>document.id)]});
    return this.view(next);
  }

  private async assessFindings(action:Extract<WorkflowAction,{action:'assess_findings'}>){
    const state=await this.loadState(action.run_id,action.expected_version);
    if(state.phase!=='findings_ready')throw new Error(`assess_findings is not allowed during ${state.phase}`);
    const supplied=action.assessments.map(assessment=>assessment.finding_id);
    if(new Set(supplied).size!==supplied.length||supplied.length!==state.pending_finding_ids.length||supplied.some(findingId=>!state.pending_finding_ids.includes(findingId)))throw new Error('Assessments must cover every pending finding exactly once');
    const claims=await Promise.all(state.claim_ids.map(claimId=>this.store.get(claimId)));
    const fetched=await Promise.all(state.fetched_document_ids.map(documentId=>this.store.get(documentId)));
    const prepared:{assessment:(typeof action.assessments)[number];finding:Document}[]=[];
    for(const assessment of action.assessments){
      const finding=await this.store.get(assessment.finding_id);const findingFetches=fetched.filter(document=>document.finding_id===finding.id);
      if(assessment.evidence.some(evidence=>!claims.some(claim=>claim.id===evidence.claim_id)))throw new Error('Evidence assessment references an unknown claim');
      for(const evidence of assessment.evidence){
        const source=evidence.fetched_document_id===null?finding:findingFetches.find(document=>document.id===evidence.fetched_document_id);
        if(!source)throw new Error('Evidence assessment references an unrelated fetched document');
        const sourceText=String(source.kind==='fetched_document'?source.markdown:source.content);
        if(evidence.passage&&!sourceText.includes(evidence.passage))throw new Error('Evidence passage must appear verbatim in its source');
      }
      prepared.push({assessment,finding});
    }
    const gaps=await Promise.all(state.gap_ids.map(gapId=>this.store.get(gapId)));
    if(new Set(action.gap_resolutions.map(resolution=>resolution.gap_id)).size!==action.gap_resolutions.length)throw new Error('Gap resolutions must be unique');
    for(const resolution of action.gap_resolutions){
      const gap=gaps.find(candidate=>candidate.id===resolution.gap_id);
      if(!gap)throw new Error('Gap resolution references an unknown gap');
      const affectedClaims=new Set(Array.isArray(gap.affected_claim_ids)?gap.affected_claim_ids.map(String):[]);
      const linkedFindingIds=new Set(prepared.filter(item=>Array.isArray(item.finding.gap_ids)&&item.finding.gap_ids.includes(gap.id)
        &&item.assessment.evidence.some(evidence=>affectedClaims.has(evidence.claim_id))).map(item=>item.finding.id));
      const linkedFetchedIds=new Set(fetched.filter(document=>linkedFindingIds.has(String(document.finding_id))).map(document=>document.id));
      const allowedEvidence=new Set([...linkedFindingIds,...linkedFetchedIds]);
      if(resolution.evidence_ids.some(evidenceId=>!allowedEvidence.has(evidenceId)))throw new Error('Gap resolution requires new evidence retrieved for that gap');
    }
    const newEvidence:Document[]=[];
    for(const {assessment,finding} of prepared){
      for(const [index,evidence] of assessment.evidence.entries()){
        const source=evidence.fetched_document_id===null?finding:fetched.find(document=>document.id===evidence.fetched_document_id)!;
        newEvidence.push(await this.store.save(state.run_id,'evidence_assessment',{...evidence,finding_id:finding.id,
          source_id:source.id,source_version:source.version,source_type:assessment.source_type,publication_date:assessment.publication_date,
          source_origin:assessment.source_origin,independence:assessment.independence,policy_version:'evidence-review-v1'},
          `${state.run_id}/evidence/${finding.id}/${index+1}`));
      }
      const findingEvidence=newEvidence.filter(evidence=>evidence.finding_id===finding.id);
      await this.store.save(state.run_id,'finding',{...finding,...assessment,evidence_assessment_ids:findingEvidence.map(evidence=>evidence.id),
        assessment_status:'completed'},`${state.run_id}/assessment/${finding.id}`,{id:finding.id,version:finding.version});
    }
    const oldEvidence=await Promise.all(state.evidence_assessment_ids.map(evidenceId=>this.store.get(evidenceId)));const allEvidence=[...oldEvidence,...newEvidence];
    for(const claim of claims){
      if(claim.role==='observation')continue;
      const claimEvidence=allEvidence.filter(evidence=>evidence.claim_id===claim.id);
      const status=this.evidenceStatus(claimEvidence.map(evidence=>String(evidence.verdict)));
      await this.store.save(state.run_id,'claim',{...claim,evidence_status:status,evidence_assessment_ids:claimEvidence.map(evidence=>evidence.id),
        source_ids:this.unique(claimEvidence.map(evidence=>String(evidence.source_id)))},`${state.run_id}/claim-review/${claim.id}/${state.attempts}`,
        {id:claim.id,version:claim.version});
    }
    for(const resolution of action.gap_resolutions){
      const gap=gaps.find(candidate=>candidate.id===resolution.gap_id)!;
      await this.store.save(state.run_id,'research_gap',{...gap,status:resolution.status,evidence_ids:resolution.evidence_ids,
        resolution_reason:resolution.reason,resolved_at:this.now().toISOString()},`${state.run_id}/gap-resolution/${gap.id}/${state.attempts}`,
        {id:gap.id,version:gap.version});
    }
    const exhausted=state.attempts>=this.config.research.max_attempts;
    const next=await this.reviseState(state,{phase:exhausted?'ready_for_hypothesis':'findings_assessed',pending_finding_ids:[],
      evidence_assessment_ids:[...state.evidence_assessment_ids,...newEvidence.map(evidence=>evidence.id)],
      unresolved_questions:this.unique([...state.unresolved_questions,...action.assessments.flatMap(assessment=>[assessment.uncertainty,...assessment.contradictions]).filter(Boolean)]),
      stop_reason:exhausted?'budget_reached':null});
    return this.view(next);
  }

  private async submitHypothesis(action:Extract<WorkflowAction,{action:'submit_hypothesis'}>){
    const state=await this.loadState(action.run_id,action.expected_version);
    if(!['findings_assessed','ready_for_hypothesis'].includes(state.phase))throw new Error(`submit_hypothesis is not allowed during ${state.phase}`);
    const assessedFindings=await this.relevantFindings(state);
    if(state.phase==='findings_assessed'&&state.attempts<Math.min(2,this.config.research.max_attempts)&&assessedFindings.length)throw new Error('A relevant initial finding requires one referenced follow-up query before hypothesis submission');
    const stopReason=state.stop_reason??action.stop_reason;if(!stopReason)throw new Error('A stop reason is required before submitting the hypothesis');
    if(state.stop_reason&&action.stop_reason&&action.stop_reason!==state.stop_reason)throw new Error('Stop reason conflicts with the enforced workflow outcome');
    const research=await this.researchAssessment(state);
    if(stopReason==='sufficient_evidence'&&research.status!=='supported')throw new Error(`Sufficient evidence requirements failed: ${research.reasons.join('; ')}`);
    const analytics=await this.store.get(state.analytics_id);const permitted=new Set([analytics.id,...assessedFindings.map(finding=>finding.id)]);
    if(!action.hypothesis.source_ids.includes(analytics.id))throw new Error('Hypothesis must cite this run’s analytics');
    if(action.hypothesis.source_ids.some(sourceId=>!permitted.has(sourceId)))throw new Error('Hypothesis cites evidence that is unknown, irrelevant, or from another run');
    if(assessedFindings.length&&!action.hypothesis.source_ids.some(sourceId=>assessedFindings.some(finding=>finding.id===sourceId)))throw new Error('Hypothesis must cite at least one relevant Linkup finding');
    const claims=await Promise.all(state.claim_ids.map(claimId=>this.store.get(claimId)));const hypothesisClaims=action.hypothesis.claim_ids;
    if(state.claim_ids.length===0?hypothesisClaims.length>0:hypothesisClaims.length===0||hypothesisClaims.some(claimId=>!state.claim_ids.includes(claimId)))throw new Error('Hypothesis must reference claims from this research plan');
    const decisive=claims.filter(claim=>claim.decisive===true).map(claim=>claim.id);
    if(decisive.some(claimId=>!hypothesisClaims.includes(claimId)))throw new Error('Hypothesis must address every decisive claim');
    const evidence=await Promise.all(state.evidence_assessment_ids.map(evidenceId=>this.store.get(evidenceId)));
    for(const claim of claims.filter(item=>item.decisive===true&&item.role!=='observation'&&!['not_checked','insufficient_evidence'].includes(String(item.evidence_status)))){
      const reviewedFindings=evidence.filter(item=>item.claim_id===claim.id&&item.verdict!=='insufficient_evidence').map(item=>String(item.finding_id));
      if(!reviewedFindings.some(findingId=>action.hypothesis.source_ids.includes(findingId)))throw new Error('Hypothesis must cite reviewed evidence for every decisive claim it addresses');
    }
    const gaps=await Promise.all(state.gap_ids.map(gapId=>this.store.get(gapId)));const unresolvedGaps=gaps.filter(gap=>gap.status!=='resolved');
    const hypothesisInput={...action.hypothesis,uncertainties:this.unique([...action.hypothesis.uncertainties,...state.unresolved_questions,
      ...unresolvedGaps.map(gap=>`Unresolved ${gap.importance} gap: ${gap.question}`),...assessedFindings.filter(finding=>action.hypothesis.source_ids.includes(finding.id))
        .flatMap(finding=>[String(finding.uncertainty??''),...(Array.isArray(finding.contradictions)?finding.contradictions.map(String):[])])])};
    let hypothesis=await saveCandidate(this.store,this.config,state.run_id,hypothesisInput,`${state.run_id}/hypothesis`,this.now());
    hypothesis=await this.store.save(state.run_id,'hypothesis',{...hypothesis,research_status:research.status,
      evidence_policy_version:'evidence-review-v1',evidence_assessment_ids:state.evidence_assessment_ids,gap_ids:state.gap_ids,
      unresolved_gap_ids:unresolvedGaps.map(gap=>gap.id),experiment_eligibility:research.status==='supported'?'supported':'exploratory'},
      `${state.run_id}/hypothesis/research-status`,{id:hypothesis.id,version:hypothesis.version});
    const assessment=await this.saveResearchAssessment(state,research);
    await this.store.save(state.run_id,'research_stop',{reason:stopReason,attempts:state.attempts,research_status:research.status,
      unresolved_gap_ids:unresolvedGaps.map(gap=>gap.id),unresolved_questions:state.unresolved_questions},`${state.run_id}/research-stop`);
    await this.completeRun(state,{hypothesis:hypothesis.id,conclusion:null,assessment:assessment.id},stopReason,research.status);
    const completed=await this.reviseState(state,{phase:'completed',stop_reason:stopReason});return this.view(completed,hypothesis);
  }

  private async completeWithoutHypothesis(action:Extract<WorkflowAction,{action:'complete_without_hypothesis'}>){
    const state=await this.loadState(action.run_id,action.expected_version);
    if(!['findings_assessed','ready_for_hypothesis'].includes(state.phase))throw new Error(`complete_without_hypothesis is not allowed during ${state.phase}`);
    const stopReason=state.stop_reason??action.stop_reason;
    if(!stopReason)throw new Error('A stop reason is required before completing research');
    if(state.stop_reason&&action.stop_reason&&action.stop_reason!==state.stop_reason)throw new Error('Stop reason conflicts with the enforced workflow outcome');
    const research=await this.researchAssessment(state);const gaps=await Promise.all(state.gap_ids.map(gapId=>this.store.get(gapId)));
    const uncertainties=this.unique([...action.conclusion.uncertainties,...state.unresolved_questions,
      ...gaps.filter(gap=>gap.status!=='resolved').map(gap=>`Unresolved ${gap.importance} gap: ${gap.question}`)]);
    const conclusion=await this.store.save(state.run_id,'research_conclusion',{...action.conclusion,uncertainties,
      research_status:research.status,evidence_policy_version:'evidence-review-v1',claim_ids:state.claim_ids,gap_ids:state.gap_ids,
      evidence_assessment_ids:state.evidence_assessment_ids},`${state.run_id}/conclusion`);
    const assessment=await this.saveResearchAssessment(state,research);
    await this.store.save(state.run_id,'research_stop',{reason:stopReason,attempts:state.attempts,research_status:research.status,
      unresolved_gap_ids:gaps.filter(gap=>gap.status!=='resolved').map(gap=>gap.id),unresolved_questions:uncertainties},`${state.run_id}/research-stop`);
    await this.completeRun(state,{hypothesis:null,conclusion:conclusion.id,assessment:assessment.id},stopReason,research.status);
    const completed=await this.reviseState(state,{phase:'completed',stop_reason:stopReason,conclusion_id:conclusion.id});
    return this.view(completed,null,conclusion);
  }

  private async researchAssessment(state:WorkflowState):Promise<{status:ResearchStatus;reasons:string[];decisive_claim_ids:string[];unresolved_gap_ids:string[];independent_origins:number}>{
    const [claims,gaps,evidence]=await Promise.all([Promise.all(state.claim_ids.map(claimId=>this.store.get(claimId))),
      Promise.all(state.gap_ids.map(gapId=>this.store.get(gapId))),Promise.all(state.evidence_assessment_ids.map(evidenceId=>this.store.get(evidenceId)))]);
    const decisive=claims.filter(claim=>claim.decisive===true);const unresolvedBlocking=gaps.filter(gap=>gap.importance==='blocking'&&gap.status!=='resolved');
    const challenge=gaps.filter(gap=>gap.purpose==='challenge');const challengeComplete=challenge.some(gap=>Number(gap.search_attempts??0)>0&&gap.status==='resolved');
    const unsupported=decisive.filter(claim=>claim.evidence_status!=='supported');const reasons:string[]=[];
    if(!decisive.length)reasons.push('No decisive claims were identified');
    if(unsupported.length)reasons.push(`${unsupported.length} decisive claim(s) are not supported`);
    if(unresolvedBlocking.length)reasons.push(`${unresolvedBlocking.length} blocking gap(s) remain unresolved`);
    if(!challengeComplete)reasons.push('No challenge gap was both searched and resolved');
    const status:ResearchStatus=decisive.length&&unsupported.length===0&&!unresolvedBlocking.length&&challengeComplete?'supported':
      evidence.some(item=>item.verdict!=='insufficient_evidence')?'partial':'inconclusive';
    const origins=new Set(evidence.map(item=>String(item.source_origin??item.source_id)).filter(Boolean));
    return {status,reasons,decisive_claim_ids:decisive.map(claim=>claim.id),unresolved_gap_ids:gaps.filter(gap=>gap.status!=='resolved').map(gap=>gap.id),independent_origins:origins.size};
  }

  private saveResearchAssessment(state:WorkflowState,research:Awaited<ReturnType<AnalysisWorkflow['researchAssessment']>>){
    return this.store.save(state.run_id,'research_assessment',{...research,policy_version:'evidence-review-v1',claim_ids:state.claim_ids,
      gap_ids:state.gap_ids,evidence_assessment_ids:state.evidence_assessment_ids},`${state.run_id}/research-assessment`);
  }

  private evidenceStatus(verdicts:string[]){
    if(verdicts.includes('mixed')||(verdicts.includes('supported')&&verdicts.includes('refuted')))return 'mixed';
    if(verdicts.includes('refuted'))return 'refuted';
    if(verdicts.includes('supported'))return 'supported';
    return 'insufficient_evidence';
  }

  private async loadState(runId:string,expectedVersion:number):Promise<WorkflowState>{
    const matches=(await this.store.list('workflow_state')).filter(record=>record.run_id===runId);if(matches.length!==1)throw new Error('Workflow state unavailable');
    const state=stateSchema.parse(matches[0]) as WorkflowState;if(state.version!==expectedVersion)throw new Error(`Stale workflow state; expected version ${state.version}`);return state;
  }
  private async reviseState(state:WorkflowState,changes:Partial<StateFields>):Promise<WorkflowState>{const next={...state,...changes};return stateSchema.parse(await this.store.save(state.run_id,'workflow_state',stateBody(next),`${state.run_id}/state/${state.version+1}`,{id:state.id,version:state.version})) as WorkflowState;}
  private async relevantFindings(state:WorkflowState){const findings=await Promise.all(state.finding_ids.map(findingId=>this.store.get(findingId)));return findings.filter(finding=>finding.assessment_status==='completed'&&finding.relevant===true);}
  private async completeRun(state:WorkflowState,result:{hypothesis:string|null;conclusion:string|null;assessment?:string|null},stopReason:StopReason,researchStatus:ResearchStatus){
    const run=await this.store.get(state.run_record_id);return this.store.save(state.run_id,'run',{status:'completed',request:state.request,config:this.config,
      workflow_version:'state-machine-v2',result_ids:{insights:state.insight_ids,hypothesis:result.hypothesis,conclusion:result.conclusion,
        research_assessment:result.assessment??null,findings:state.finding_ids,claims:state.claim_ids,gaps:state.gap_ids,
        evidence_assessments:state.evidence_assessment_ids,decisions:state.decision_ids},stop_reason:stopReason,research_status:researchStatus,
      attempts:state.attempts,fetches:state.fetches},`${state.run_id}/complete`,{id:run.id,version:run.version});
  }
  private async view(state:WorkflowState,hypothesis?:Document|null,providedConclusion?:Document|null){
    const [analytics,insights,claims,gaps,findings,fetchedDocuments,evidenceAssessments,storedConclusion]=await Promise.all([
      this.store.get(state.analytics_id),Promise.all(state.insight_ids.map(recordId=>this.store.get(recordId))),
      Promise.all(state.claim_ids.map(recordId=>this.store.get(recordId))),Promise.all(state.gap_ids.map(recordId=>this.store.get(recordId))),
      Promise.all(state.finding_ids.map(recordId=>this.store.get(recordId))),Promise.all(state.fetched_document_ids.map(recordId=>this.store.get(recordId))),
      Promise.all(state.evidence_assessment_ids.map(recordId=>this.store.get(recordId))),state.conclusion_id?this.store.get(state.conclusion_id):null]);
    const requiresFollowUp=state.phase==='findings_assessed'&&state.attempts<Math.min(2,this.config.research.max_attempts)&&findings.some(finding=>finding.assessment_status==='completed'&&finding.relevant===true);
    const canFetch=Boolean(this.research.fetch)&&state.fetches<this.config.research.max_fetches;
    const next_actions=state.phase==='research_planning'||(state.phase==='analytics_ready'&&!state.claim_ids.length)?['plan_research']:state.phase==='analytics_ready'?['submit_query']:
      state.phase==='findings_ready'?(canFetch?['fetch_sources','assess_findings']:['assess_findings']):
      state.phase==='findings_assessed'?(requiresFollowUp?['submit_query']:state.attempts<this.config.research.max_attempts?['submit_query','submit_hypothesis','complete_without_hypothesis']:['submit_hypothesis','complete_without_hypothesis']):
      state.phase==='ready_for_hypothesis'?['submit_hypothesis','complete_without_hypothesis']:[];
    const researchAssessment=state.claim_ids.length?await this.researchAssessment(state):null;
    return {run_id:state.run_id,state_version:state.version,phase:state.phase,next_actions,attempts:state.attempts,
      max_attempts:this.config.research.max_attempts,fetches:state.fetches,max_fetches:this.config.research.max_fetches,
      stop_reason:state.stop_reason,research_assessment:researchAssessment,unresolved_questions:state.unresolved_questions,
      analytics,insights,claims,gaps,findings,fetched_documents:fetchedDocuments,evidence_assessments:evidenceAssessments,
      ...((providedConclusion??storedConclusion)?{conclusion:providedConclusion??storedConclusion}:{}),
      ...(hypothesis===undefined?{}:{hypothesis})};
  }
  private unique(values:string[]){return [...new Set(values.filter(Boolean))];}
}
