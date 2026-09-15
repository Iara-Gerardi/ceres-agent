import test from 'node:test';
import assert from 'node:assert/strict';
import { testStore } from './store.ts';
import { configSchema, candidateSchema, metricSchema, usageSchema, uuid7 } from '../core/contracts.ts';
import { score,saveCandidate,usable } from '../core/validation.ts';
import { FileStore } from '../adapters/file-store.ts';
import sample from '../config/sample.json' with {type:'json'};
const config=configSchema.parse(sample);
const metric={metric:'conversion',value:13/15,unit:'fraction',numerator:13,denominator:15,population:'eligible unique visitors',period:{start:'2026-09-01T00:00:00Z',end:'2026-09-10T00:00:00Z'}};

test('versioned scoring matches hand calculation and mandatory evidence gates activation',async()=>{
 assert.equal(score({data:true,definitions:true,counts:true,traceable:true,sample:false,windows:true,coverage:true}).trust,80);
 assert.equal(score({data:true,definitions:true,counts:true,traceable:false,sample:true,windows:true,coverage:true}).trust,85);
 const d=await testStore();try {
 const run=uuid7();const evidence=await d.store.save(run,'analytics',{metrics:[metric],usage:{used:30,read:50,exclusions:['20 unrelated records']},failures:[]},'evidence');
 const draft={kind:'insight',statement:'Observed conversion',source_ids:[evidence.id],key_metrics:['conversion']};
 const rejected=await saveCandidate(d.store,config,run,draft,'candidate-a');
 assert.equal(rejected.trust,70);assert.equal(rejected.analytics_evidence_quality,70);assert.equal(rejected.active,false);
 const hypothesis=await saveCandidate(d.store,config,run,{...draft,kind:'hypothesis',suggested_test:'Simplify onboarding and observe conversion'},'candidate-b');
 assert.equal(hypothesis.active,true);
 const missing=await saveCandidate(d.store,config,run,{...draft,source_ids:[uuid7()]},'candidate-c');
 assert.equal(missing.active,false);
 const noTest=await saveCandidate(d.store,config,run,{...draft,kind:'hypothesis'},'candidate-d'); assert.equal(noTest.active,false);
 assert.equal((await d.store.list('insight')).length,2);
 assert.deepEqual(rejected.evidence_usage,[{used:30,read:50,exclusions:['20 unrelated records']}]);
 assert.deepEqual(rejected.metric_observations,[metric]);
 assert.equal(usable({...hypothesis,review_due_at:new Date().toISOString()}),false);
 }finally{await d.close();}
});

test('schemas reject derived fields and malformed ratios without writes',()=>{
 for(const body of [{trust:100},{active:true},{run_id:uuid7()}]) assert.equal(candidateSchema.safeParse({kind:'insight',statement:'x',source_ids:[],key_metrics:[],...body}).success,false);
 assert.equal(usageSchema.safeParse({used:51,read:50,exclusions:[]}).success,false);
 assert.equal(metricSchema.safeParse({...metric,numerator:16}).success,false);
 assert.equal(metricSchema.safeParse({...metric,period:{start:'bad',end:'bad'}}).success,false);
 assert.equal(metricSchema.safeParse({...metric,denominator:0,numerator:0,value:null}).success,true);
});

test('file storage persists records, revisions, history and idempotent retries',async()=>{
 const d=await testStore(true);try{
 const run=uuid7();
 const first=await d.store.save(run,'insight',{statement:'first'},'create');
 const next=await d.store.save(run,'insight',{statement:'next'},'update',{id:first.id,version:1});
 const retry=await d.store.save(run,'insight',{statement:'next'},'update',{id:first.id,version:1});assert.equal(retry.version,2);
 assert.equal(next.version,2);assert.equal((await d.store.history(first.id)).length,2);
 await assert.rejects(d.store.save(run,'insight',{statement:'race'},'race',{id:first.id,version:1}));
 assert.equal((await d.store.history(first.id)).length,2);
 const reopened=new FileStore(d.path);assert.equal((await reopened.get(first.id)).version,2);assert.equal((await reopened.list('insight')).length,1);
 }finally{await d.close();}
});

test('score-80 activation and unusable source exclusion',async()=>{
 const d=await testStore();try{
 const run=uuid7();const evidence=await d.store.save(run,'analytics',{metrics:[metric],usage:{used:15,read:15,exclusions:[]},failures:[]},'evidence');
 const candidate={kind:'insight',statement:'Observation',source_ids:[evidence.id],key_metrics:['conversion']};
 const active=await saveCandidate(d.store,config,run,candidate,'active');assert.equal(active.trust,80);assert.equal(active.active,true);
 const expired=await d.store.save(run,'insight',{...active,review_due_at:'2020-01-01T00:00:00Z'},'expired',{id:active.id,version:1});
 const next=await saveCandidate(d.store,config,run,{...candidate,kind:'hypothesis',source_ids:[expired.id],suggested_test:'Observe conversion after a change'},'next');assert.equal(next.active,false);
 }finally{await d.close();}
});
