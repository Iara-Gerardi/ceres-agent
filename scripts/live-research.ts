import { mkdir,writeFile } from 'node:fs/promises';
import { database } from '../tests/database.ts';
import { configSchema } from '../core/contracts.ts';
import { EventAnalytics } from '../adapters/analytics.ts';
import { Linkup } from '../adapters/linkup.ts';
import { ModelReasoner } from '../adapters/reasoner.ts';
import { AnalysisWorkflow } from '../core/workflow.ts';
import sample from '../config/sample.json' with {type:'json'};
import events from '../config/sample-events.json' with {type:'json'};
if(!process.env.LINKUP_API_KEY || !(process.env.OPENAI_API_KEY || process.env.AI_GATEWAY_API_KEY)) throw new Error('Live research requires Linkup and model credentials');
const db=await database();
try {
 const workflow=new AnalysisWorkflow(db.store,new EventAnalytics(async()=>events),new Linkup(process.env.LINKUP_API_KEY),new ModelReasoner(),configSchema.parse(sample));
 const result=await workflow.execute({question:'Using the labeled sample channel conversion analytics, investigate whether search-intent mismatch or account-creation onboarding friction could explain the observed conversion weakness. Find relevant research, then investigate a specific unresolved detail from a saved finding before proposing a tentative hypothesis and suggested test. Do not claim external evidence proves the cause in this sample.',period:{start:'2026-09-07T00:00:00Z',end:'2026-09-10T12:00:00Z'},research:true});
 await mkdir('evals/results/live-local',{recursive:true});
 await writeFile('evals/results/live-local/result.json',JSON.stringify({result,records:await db.store.list()},null,2));
 if(!('hypothesis' in result) || !result.hypothesis?.active || result.findings.length===0 || result.attempts<2) { console.log(JSON.stringify({status:'incomplete',run_id:result.run_id}));process.exitCode=1; }
 else console.log(JSON.stringify({status:'pass',run_id:result.run_id,attempts:result.attempts,findings:result.findings.length,hypothesis:result.hypothesis.id,report:'evals/results/live-local/result.json'}));
}finally{await db.close();}
