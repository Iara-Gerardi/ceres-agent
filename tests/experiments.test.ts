import test from 'node:test';
import assert from 'node:assert/strict';
import { testStore } from './store.ts';
import { AnalysisWorkflow } from '../core/workflow.ts';
import { saveExperiment } from '../core/experiments.ts';
import { configSchema, uuid7, type Store } from '../core/contracts.ts';
import { EventAnalytics } from '../adapters/analytics.ts';
import events from '../config/sample-events.json' with {type:'json'};
import sample from '../config/sample.json' with {type:'json'};

async function research(store: Store) {
  const workflow = new AnalysisWorkflow(store, new EventAnalytics(async () => events), {
    async search() { return [{name:'Study', url:'https://example.test/study', content:'Shorter forms may reduce friction.'}]; },
  }, configSchema.parse({...sample, research:{...sample.research,max_attempts:1}}));
  let state: any = await workflow.transition({action:'start', question:'Investigate signup friction', research:true,
    period:{start:'2026-09-07T00:00:00Z',end:'2026-09-10T12:00:00Z'}});
  state = await workflow.transition({action:'submit_query',run_id:state.run_id,expected_version:state.state_version,
    query:'Signup friction evidence',reason:'Investigate the observation',based_on_ids:[]});
  state = await workflow.transition({action:'assess_findings',run_id:state.run_id,expected_version:state.state_version,
    assessments:[{finding_id:state.findings[0].id,relevant:true,summary:'Forms may introduce friction',uncertainty:'External context only',contradictions:[]}]});
  state = await workflow.transition({action:'submit_hypothesis',run_id:state.run_id,expected_version:state.state_version,
    hypothesis:{kind:'hypothesis',statement:'Signup friction may affect conversion',source_ids:[state.analytics.id,state.findings[0].id],
      key_metrics:['Search/48h'],suggested_test:'Compare a shorter form',uncertainties:['Small synthetic sample']}});
  return state.hypothesis;
}

function proposal(hypothesisId: string) {
  return {hypothesis_id:hypothesisId,title:'Shorter signup form',audience:'Eligible Search visitors',
    changes:[{target:'Signup form',control:'Current form',treatment:'Remove optional company field',reason:'Test the friction hypothesis'}],
    primary_metric:'Search/48h',success_criterion:'Compare 48-hour account creation between control and treatment; collect sufficient data before deciding.',
    guardrails:['Monitor signup errors'],uncertainties:['Current form configuration needs checking'],
    capability_check:{tool_name:null,reason:'No tool in this session can modify the signup form'}};
}

// Missing persistence or treating a proposal as executed must break this test.
test('research produces a durable experiment with manual handoff and inherited evidence', async () => {
  const d = await testStore();
  try {
    const hypothesis = await research(d.store);
    const input = proposal(hypothesis.id);
    const result = await saveExperiment(d.store,input);
    assert.equal(result.kind,'experiment');
    assert.equal(result.run_id,hypothesis.run_id);
    assert.equal(result.status,'proposed');
    assert.equal(result.execution_status,'not_started');
    assert.equal(result.handoff,'manual');
    assert.deepEqual(result.source_ids,hypothesis.source_ids);
    assert.deepEqual(result.changes,[{target:'Signup form',control:'Current form',treatment:'Remove optional company field',reason:'Test the friction hypothesis'}]);
    assert.ok((result.uncertainties as string[]).includes('Small synthetic sample'));
    assert.ok((result.uncertainties as string[]).includes('External context only'));
    assert.deepEqual(await d.store.get(result.id),result);
    assert.equal((await saveExperiment(d.store,input)).id,result.id);
    assert.equal((await d.store.list('experiment')).length,1);
    assert.equal((await d.store.history(result.id)).length,1);
    const another = await saveExperiment(d.store,{...input,title:'Alternative experiment',changes:[{...input.changes[0],treatment:'Move optional company field after signup'}]});
    assert.notEqual(another.id,result.id);
  } finally { await d.close(); }
});

// A reported tool match must never turn a stored plan into a claimed execution.
test('a tool availability assessment is saved without claiming any change ran', async () => {
  const d = await testStore();
  try {
    const hypothesis = await research(d.store);
    const result = await saveExperiment(d.store,{...proposal(hypothesis.id),
      capability_check:{tool_name:'update_signup',reason:'The session tool supports changing this form'}});
    assert.equal(result.handoff,'tool_available');
    assert.equal(result.execution_status,'not_started');
    assert.deepEqual(result.capability_check,{tool_name:'update_signup',reason:'The session tool supports changing this form'});
  } finally { await d.close(); }
});

// Reject unsupported metrics, forged execution fields and unusable hypotheses before writing.
test('invalid experiment proposals cannot become saved experiments', async () => {
  const d = await testStore();
  try {
    const hypothesis = await research(d.store);
    const input = proposal(hypothesis.id);
    for (const invalid of [
      {...input,primary_metric:'invented_metric'}, {...input,status:'running'}, {...input,execution_status:'completed'},
      {...input,changes:[]}, {...input,changes:[{...input.changes[0],treatment:' '}]},
      {...input,source_ids:[uuid7()]}, {...input,hypothesis_id:hypothesis.source_ids[0]},
    ]) await assert.rejects(saveExperiment(d.store,invalid));
    await assert.rejects(saveExperiment(d.store,input,new Date('2100-01-01T00:00:00Z')),/current hypothesis/);
    await d.store.save(hypothesis.run_id,'hypothesis',{...hypothesis,active:false},'deactivate',{id:hypothesis.id,version:hypothesis.version});
    await assert.rejects(saveExperiment(d.store,input),/current hypothesis/);
    assert.equal((await d.store.list('experiment')).length,0);
  } finally { await d.close(); }
});
