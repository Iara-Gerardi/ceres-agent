import { z } from 'zod';
import { errorCategory } from './errors.ts';
import { configSchema, periodSchema, decisionSchema, assessmentSchema, uuid7, type Store, type AnalyticsAdapter, type ResearchAdapter, type Reasoner, type Document, type ProjectConfig } from './contracts.ts';
import { saveCandidate, usable } from './validation.ts';
export const requestSchema = z.object({ question:z.string().min(1).max(4000), period:periodSchema, research:z.boolean().default(true) }).strict();
export class AnalysisWorkflow {
  constructor(private store: Store, private analytics: AnalyticsAdapter, private research: ResearchAdapter, private reasoner: Reasoner, private config: ProjectConfig, private now = () => new Date()) { configSchema.parse(config); }
  async execute(input: unknown) {
    const request = requestSchema.parse(input); const run = uuid7(this.now().getTime());
    let sequence = 0;
    const record = (kind:string, body:Record<string,unknown>) => this.store.save(run,kind,body,`${run}/${++sequence}`);
    const started = await record('run',{status:'running', request, config:this.config, workflow_version:'requested-v1'});
    const insights: Document[] = []; const findings: Document[] = []; const decisions: Document[] = [];
    let attempts = 0; let stopReason = 'analytics_only'; let unresolved: string[] = [];
    try {
      let evidence;
      try { evidence = await this.analytics.read(this.config,request.period); }
      catch { await record('failure',{analysis:'requested',reason:'Required analytics or definition unavailable'}); throw new Error('Required analytics unavailable'); }
      const analytics = await record('analytics', evidence);
      for (const reason of evidence.failures) await record('failure',{analysis:reason,reason:'Affected analysis blocked; independent metrics may continue'});
      for (const metric of evidence.metrics) {
        const text = `${metric.metric}: ${metric.numerator}/${metric.denominator} eligible visitors (${metric.value === null ? 'undefined rate' : (metric.value*100).toFixed(2)+'%'}). Groups may overlap; this observation does not establish causality or superiority.`;
        insights.push(await saveCandidate(this.store,this.config,run,{kind:'insight',statement:text,source_ids:[analytics.id],key_metrics:[metric.metric],uncertainties:['Sample size and follow-up completeness limit interpretation.']},`${run}/insight/${metric.metric}`,this.now()));
      }
      const prior = (await this.store.list()).filter(d => ['insight','hypothesis'].includes(d.kind) && d.run_id !== run && usable(d,this.now()));
      const context = () => ({ request, analytics, prior:prior.filter(d => usable(d,this.now())), insights:insights.filter(d => usable(d,this.now())), findings, decisions, attempts, budget:this.config.research.max_attempts });
      if (request.research && evidence.metrics.some(m => m.value !== null)) {
        stopReason = 'budget_reached';
        const seen = new Set<string>();
        while (attempts < this.config.research.max_attempts) {
          // Re-read committed findings so subsequent decisions consume the durable evidence.
          for (let i = 0; i < findings.length; i++) findings[i] = await this.store.get(findings[i]!.id);
          const decision = decisionSchema.parse(await this.reasoner.decide(context()));
          if (decision.finding_ids.some(id => !findings.some(f => f.id === id))) throw new Error('Unknown decision finding');
          if (attempts > 0 && decision.action === 'search' && findings.length > 0 && !decision.finding_ids.length) throw new Error('Follow-up requires stored finding references');
          decisions.push(await record('research_decision',decision)); unresolved = decision.uncertainties;
          if (decision.action === 'stop') { stopReason = 'sufficient_or_diminishing_value'; break; }
          if (!decision.query.trim()) throw new Error('Empty research query');
          if (seen.has(decision.query.trim().toLowerCase())) { stopReason = 'repeated_query'; break; }
          seen.add(decision.query.trim().toLowerCase());
          attempts++;
          await record('provider_attempt',{attempt:attempts,query:decision.query,decision_id:decisions.at(-1)!.id,prior_finding_ids:decision.finding_ids});
          let results;
          try { results = await this.research.search(decision.query,this.config.research.max_results); }
          catch { await record('failure',{analysis:'research',reason:'Provider unavailable, timed out, or returned invalid output',attempt:attempts}); unresolved.push('Research retrieval failed.'); stopReason='provider_error'; break; }
          let added = 0; const fresh: Document[] = [];
          for (const result of results) {
            if (findings.some(f => f.url === result.url && f.content === result.content)) continue;
            const saved = await record('finding',{ question:request.question, query:decision.query, ...result, retrieved_at:this.now().toISOString(), uncertainty:'External evidence requires relevance assessment; it does not establish project causality.', contradictions:[], prior_finding_ids:decision.finding_ids, decision_id:decisions.at(-1)!.id }); findings.push(saved); fresh.push(saved); added++;
          }
          if (fresh.length) {
            const assessment = assessmentSchema.parse(await this.reasoner.assess({request,analytics,prior_findings:findings.filter(f => !fresh.includes(f)),new_findings:fresh}));
            if (assessment.assessments.length !== fresh.length || new Set(assessment.assessments.map(a=>a.finding_id)).size !== fresh.length || assessment.assessments.some(a => !fresh.some(f=>f.id===a.finding_id))) throw new Error('Invalid finding assessment references');
            for (const a of assessment.assessments) {
              const original = fresh.find(f=>f.id===a.finding_id)!;
              const updated = await this.store.save(run,'finding',{...original,...a},`${run}/assessment/${original.id}`,{id:original.id,version:original.version});
              findings[findings.findIndex(f=>f.id===original.id)] = updated;
            }
          }
          if (!added) { stopReason = results.length ? 'diminishing_value' : 'empty_results'; unresolved.push('No new supporting evidence retrieved.'); break; }
        }
      }
      await record('research_stop',{reason:stopReason,attempts,unresolved_questions:unresolved});
      let hypothesis: Document | null = null;
      if (request.research && evidence.metrics.some(m => m.value !== null)) {
        for (let i=0;i<findings.length;i++) findings[i]=await this.store.get(findings[i]!.id);
        const candidate = await this.reasoner.hypothesize({...context(),stop_reason:stopReason,unresolved_questions:unresolved});
        if (candidate.kind !== 'hypothesis') throw new Error('Expected hypothesis');
        const citedFindings = findings.filter(f => candidate.source_ids.includes(f.id));
        candidate.uncertainties = [...new Set([...candidate.uncertainties,...unresolved,...citedFindings.flatMap(f => [String(f.uncertainty ?? ''),...(Array.isArray(f.contradictions) ? f.contradictions.map(String) : [])])].filter(Boolean))].slice(0,30);
        hypothesis = await saveCandidate(this.store,this.config,run,candidate,`${run}/hypothesis`,this.now());
      }
      const result = {run_id:run,insights,hypothesis,findings,decisions,stop_reason:stopReason,attempts};
      await this.store.save(run,'run',{status:'completed',request,config:this.config,workflow_version:'requested-v1',result},`${run}/complete`,{id:started.id,version:started.version});
      return result;
    } catch (error) {
      // Never return provider/SQL/model error bodies that may contain credentials or prompts.
      await record('failure',{analysis:'workflow',reason:errorCategory(error)});
      for (const insight of insights.filter(i => i.active)) await this.store.save(run,'insight',{...insight,active:false,inactive_reason:'Run failed before completion'},`${run}/deactivate/${insight.id}`,{id:insight.id,version:insight.version});
      await this.store.save(run,'run',{status:'failed',request,config:this.config,workflow_version:'requested-v1'},`${run}/failed`,{id:started.id,version:started.version});
      return {run_id:run,status:'failed',reason:errorCategory(error)};
    }
  }
}
