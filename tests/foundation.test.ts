import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './database.ts';
import { configSchema, candidateSchema, metricSchema, usageSchema, uuid7 } from '../core/contracts.ts';
import { score,saveCandidate,usable } from '../core/validation.ts';
import { PostgresStore } from '../adapters/postgres-store.ts';
import sample from '../config/sample.json' with {type:'json'};
const config=configSchema.parse(sample);
const metric={metric:'conversion',value:13/15,unit:'fraction',numerator:13,denominator:15,population:'eligible unique visitors',period:{start:'2026-09-01T00:00:00Z',end:'2026-09-10T00:00:00Z'}};

test('versioned scoring matches hand calculation and mandatory evidence gates activation',async()=>{
 assert.equal(score({data:true,definitions:true,counts:true,traceable:true,sample:false,windows:true,coverage:true}).trust,80);
 assert.equal(score({data:true,definitions:true,counts:true,traceable:false,sample:true,windows:true,coverage:true}).trust,85);
 const d=await database();try {
 const run=uuid7();const evidence=await d.store.save(run,'analytics',{metrics:[metric],usage:{used:30,read:50,exclusions:['20 unrelated records']},failures:[]},'evidence');
 const draft={kind:'insight',statement:'Observed conversion',source_ids:[evidence.id],key_metrics:['conversion']};
 const rejected=await saveCandidate(d.store,config,run,draft,'candidate-a');
 assert.equal(rejected.trust,70);assert.equal(rejected.active,false);
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

test('schemas reject spoofing and malformed ratios without writes',()=>{
 for(const body of [{trust:100},{active:true},{workspace_id:uuid7()}]) assert.equal(candidateSchema.safeParse({kind:'insight',statement:'x',source_ids:[],key_metrics:[],...body}).success,false);
 assert.equal(usageSchema.safeParse({used:51,read:50,exclusions:[]}).success,false);
 assert.equal(metricSchema.safeParse({...metric,numerator:16}).success,false);
 assert.equal(metricSchema.safeParse({...metric,period:{start:'bad',end:'bad'}}).success,false);
 assert.equal(metricSchema.safeParse({...metric,denominator:0,numerator:0,value:null}).success,true);
});

test('scoped reads, source validation, optimistic revisions, retry and rollback',async()=>{
 const d=await database();try{
 const run=uuid7(); const foreign=await d.foreignStore.save(run,'analytics',{metrics:[metric],usage:{used:1,read:1,exclusions:[]},failures:[]},'foreign');
 await assert.rejects(d.store.get(foreign.id)); assert.deepEqual(await d.store.history(foreign.id),[]);assert.equal((await d.store.list()).length,0);
 const forged=await saveCandidate(d.store,config,run,{kind:'insight',statement:'bad premise',source_ids:[foreign.id],key_metrics:['conversion']},'bad');assert.equal(forged.active,false);
 const first=await d.store.save(run,'insight',{statement:'first'},'create');
 const next=await d.store.save(run,'insight',{statement:'next'},'update',{id:first.id,version:1});
 const retry=await d.store.save(run,'insight',{statement:'next'},'update',{id:first.id,version:1});assert.equal(retry.version,2);
 assert.equal(next.version,2);assert.equal((await d.store.history(first.id)).length,2);
 await assert.rejects(d.store.save(run,'insight',{statement:'race'},'race',{id:first.id,version:1}));
 assert.equal((await d.store.history(first.id)).length,2);
 await assert.rejects(d.store.save(run,'analytics',{},'foreign-write',{id:foreign.id,version:1}));
 await assert.rejects(new PostgresStore(d.pool,d.workspace,'wrong-owner').list());
 // Induce a database failure after the document mutation to verify atomic rollback.
 await d.db.exec("CREATE FUNCTION ceres.reject_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='interrupt' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_history BEFORE INSERT ON ceres.history FOR EACH ROW EXECUTE FUNCTION ceres.reject_history();");
 await assert.rejects(d.store.save(run,'insight',{statement:'not committed'},'interrupt',{id:first.id,version:2}));
 assert.equal((await d.store.get(first.id)).version,2);
 }finally{await d.close();}
});

test('database RLS and analytics SELECT-only grants reject foreign access and mutations',async()=>{
 const d=await database();try{
 await d.foreignStore.save(uuid7(),'finding',{content:'private'},'foreign');
 await d.db.exec("SET ROLE ceres_runtime;");
 await d.db.query("SELECT set_config('ceres.workspace_id',$1,false)",[d.workspace]);
 assert.equal((await d.db.query('SELECT * FROM ceres.documents')).rows.length,0);
 await assert.rejects(d.db.query('INSERT INTO ceres.documents VALUES($1,$2,$3,$4,$5,$6)',[d.foreign,uuid7(),uuid7(),'finding',1,{}]));
 await d.db.exec('RESET ROLE; CREATE TABLE analytics_fixture(id integer); INSERT INTO analytics_fixture VALUES(1); CREATE ROLE analytics_test; GRANT SELECT ON analytics_fixture TO analytics_test; SET ROLE analytics_test;');
 for(const sql of ['INSERT INTO analytics_fixture VALUES(2)','UPDATE analytics_fixture SET id=2','DELETE FROM analytics_fixture','WITH changed AS (DELETE FROM analytics_fixture RETURNING *) SELECT * FROM changed','EXPLAIN ANALYZE INSERT INTO analytics_fixture VALUES(2)']) await assert.rejects(d.db.query(sql));
 assert.deepEqual((await d.db.query('SELECT * FROM analytics_fixture')).rows,[{id:1}]);
 }finally{await d.close();}
});

test('expired workspace access, score-80 activation and unusable source exclusion',async()=>{
 const d=await database();try{
 const run=uuid7();const evidence=await d.store.save(run,'analytics',{metrics:[metric],usage:{used:15,read:15,exclusions:[]},failures:[]},'evidence');
 const candidate={kind:'insight',statement:'Observation',source_ids:[evidence.id],key_metrics:['conversion']};
 const active=await saveCandidate(d.store,config,run,candidate,'active');assert.equal(active.trust,80);assert.equal(active.active,true);
 const expired=await d.store.save(run,'insight',{...active,review_due_at:'2020-01-01T00:00:00Z'},'expired',{id:active.id,version:1});
 const next=await saveCandidate(d.store,config,run,{...candidate,kind:'hypothesis',source_ids:[expired.id],suggested_test:'Observe conversion after a change'},'next');assert.equal(next.active,false);
 await d.db.query('UPDATE ceres.workspaces SET expires_at=$1 WHERE id=$2',['2020-01-01T00:00:00Z',d.workspace]);
 await assert.rejects(d.store.list());await assert.rejects(d.store.get(evidence.id));await assert.rejects(d.store.save(run,'finding',{},'late'));
 }finally{await d.close();}
});
