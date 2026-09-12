import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresStore } from '../adapters/postgres-store.ts';
import { uuid7 } from '../core/contracts.ts';
import { testStore } from './store.ts';

test('Postgres preserves revisions, concurrent retries, conflicts and atomic rollback', {skip:!process.env.TEST_DATABASE_URL}, async()=>{
  const d = await testStore();
  try {
    assert.ok(d.pool);
    const run = uuid7();
    const copies = await Promise.all(Array.from({length:5}, ()=>d.store.save(run,'insight',{statement:'first'},'create')));
    assert.ok(copies.every(record=>record.id===copies[0]!.id));
    const first = copies[0]!;
    const outcomes = await Promise.allSettled(['a','b'].map(operation=>d.store.save(run,'insight',{statement:operation},operation,{id:first.id,version:1})));
    assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
    const reopened = new PostgresStore(d.pool);
    assert.equal((await reopened.get(first.id)).version,2);
    assert.equal((await reopened.list('insight')).length,1);
    assert.equal((await reopened.list('hypothesis')).length,0);
    assert.deepEqual(await reopened.save(run,'insight',{},'create'),first);
    await assert.rejects(reopened.save(uuid7(),'insight',{},'wrong-run',{id:first.id,version:2}),/Revision conflict/);
    await assert.rejects(reopened.get(uuid7()),/Record unavailable/);
    // Force the history insert to fail after the current document was updated.
    await d.pool.query("ALTER TABLE ceres_document_revisions ADD CONSTRAINT reject_test_operation CHECK (operation <> 'rollback')");
    await assert.rejects(reopened.save(run,'insight',{statement:'must roll back'},'rollback',{id:first.id,version:2}));
    assert.equal((await reopened.get(first.id)).version,2);
    const history = await reopened.history(first.id);
    assert.deepEqual(history.map(entry=>entry.snapshot.version),[1,2]);
    assert.equal(history[0]!.created_at,first.created_at);
  } finally { await d.close(); }
});
