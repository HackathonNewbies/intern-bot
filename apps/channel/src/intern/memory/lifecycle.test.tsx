import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonalMemory } from './store';
import { ObservationSchema, type SourceMessage } from './model';

const owner = { workspaceId: 'demo', userId: 'alex' };
const source = (messageId: string, text: string, authorId = 'alex'): SourceMessage => ({
  threadId: 'private', messageId, authorId, text, sentAt: '2026-09-14T09:00:00+08:00', url: 'https://example.invalid/message',
});
const original = source('1', "I'll send the proposal Friday.");
const ref = (message: SourceMessage) => ({ threadId: message.threadId, messageId: message.messageId, quote: message.text });
async function setup() {
  const path = join(await mkdtemp(join(tmpdir(), 'memory-lifecycle-')), 'state.json');
  const memory = new PersonalMemory(path);
  const { item } = await memory.apply(owner, { kind: 'commitment', title: 'Send proposal',
    deadline: { kind: 'date', date: '2026-09-18', timezone: 'Asia/Singapore' }, evidence: [ref(original)] }, [original]);
  return { path, memory, taskId: item.id };
}

test('explicit completion persists without resolving an open blocker', async () => {
  const { memory, path, taskId } = await setup();
  await memory.apply(owner, { kind: 'blocker', taskId, title: 'Await approval', evidence: [ref(original)] }, [original]);
  const done = source('2', 'I sent the proposal; mark it complete.');
  const result = await memory.apply(owner, { kind: 'complete', taskId, evidence: [ref(done)] }, [done], done);
  assert.equal(result.changed, true);
  const view = await new PersonalMemory(path).view(owner);
  assert.equal(view.commitments[0].status, 'completed');
  assert.equal(view.blockers[0].status, 'open');
  assert.equal(view.commitments[0].evidence[0].messageId, '1');
  assert.equal(view.commitments[0].mutationEvidence?.[0].messageId, '2');
  assert.equal(view.mutations?.[0].kind, 'complete');
});

test('correction preserves identity and restores exact prior deadline on undo', async () => {
  const { memory, path, taskId } = await setup();
  const correction = source('2', 'Rename it Final proposal and remove its deadline.');
  await memory.apply(owner, { kind: 'correct', taskId, title: 'Final proposal', deadline: { kind: 'unknown' },
    evidence: [ref(correction)] }, [correction], correction);
  const corrected = await memory.view(owner);
  assert.equal(corrected.commitments[0].id, taskId);
  assert.equal(corrected.commitments[0].title, 'Final proposal');
  assert.deepEqual(corrected.commitments[0].deadline, { kind: 'unknown' });
  const undo = source('3', 'Undo my last change.');
  await memory.apply(owner, { kind: 'undo', changeId: corrected.mutations![0].changeId, evidence: [ref(undo)] }, [undo], undo);
  const view = await new PersonalMemory(path).view(owner);
  assert.equal(view.commitments[0].title, 'Send proposal');
  assert.deepEqual(view.commitments[0].deadline, { kind: 'date', date: '2026-09-18', timezone: 'Asia/Singapore' });
  assert.equal(view.commitments[0].mutationEvidence?.length, 2);
  assert.ok(view.mutations?.[0].undoneBy);
  assert.deepEqual(view.changes.map(change => change.kind), ['commitment', 'correct', 'undo']);
});

test('mutation evidence must belong to the current authenticated owner message', async () => {
  const { memory, path, taskId } = await setup();
  const done = source('2', 'Done.');
  const foreign = source('3', 'Approved.', 'jo');
  const before = await readFile(path, 'utf8');
  const complete = { kind: 'complete' as const, taskId, evidence: [ref(done)] };
  await assert.rejects(memory.apply(owner, complete, [done]), /current/i);
  await assert.rejects(memory.apply(owner, complete, [done], original), /current/i);
  await assert.rejects(memory.apply(owner, { ...complete, evidence: [ref(done), ref(foreign)] }, [done, foreign], done), /owner-authored/i);
  await assert.rejects(memory.apply(owner, { ...complete, evidence: [{ ...ref(done), quote: 'Invented' }] }, [done], done), /quote/);
  assert.equal(await readFile(path, 'utf8'), before);
});

test('corrections require at least one valid field', () => {
  assert.equal(ObservationSchema.safeParse({ kind: 'correct', taskId: 'x', evidence: [ref(original)] }).success, false);
  assert.equal(ObservationSchema.safeParse({ kind: 'correct', taskId: 'x', title: ' ', evidence: [ref(original)] }).success, false);
  assert.equal(ObservationSchema.safeParse({ kind: 'correct', taskId: 'x', title: 'New', evidence: [ref(original)] }).success, true);
});

test('undo is owner-global last eligible mutation and exact-ID retries never pop twice', async () => {
  const { memory, path, taskId } = await setup();
  const correction = source('2', 'Rename to Final proposal.');
  await memory.apply(owner, { kind: 'correct', taskId, title: 'Final proposal', evidence: [ref(correction)] }, [correction], correction);
  const first = (await memory.view(owner)).mutations![0].changeId;
  const done = source('3', 'Complete proposal.');
  const complete = { kind: 'complete' as const, taskId, evidence: [ref(done)] };
  await Promise.all([memory.apply(owner, complete, [done], done), new PersonalMemory(path).apply(owner, complete, [done], done)]);
  const second = (await memory.view(owner)).mutations![1].changeId;
  const undo = source('4', 'Undo.');
  await assert.rejects(memory.apply(owner, { kind: 'undo', changeId: first, evidence: [ref(undo)] }, [undo], undo), /last|latest/i);
  await memory.acknowledge(owner, (await memory.view(owner)).changes.map(change => change.id));
  const request = { kind: 'undo' as const, changeId: second, evidence: [ref(undo)] };
  const results = await Promise.all([memory.apply(owner, request, [undo], undo), new PersonalMemory(path).apply(owner, request, [undo], undo)]);
  assert.deepEqual(results.map(result => result.changed).sort(), [false, true]);
  assert.equal((await memory.apply(owner, complete, [done], done)).changed, false);
  const view = await memory.view(owner);
  assert.equal(view.commitments[0].status, 'open');
  assert.equal(view.commitments[0].title, 'Final proposal');
  assert.equal(view.changes.length, 1);
  assert.equal(view.changes[0].kind, 'undo');
  assert.equal(view.mutations!.length, 2);
  const retargetedRetry = await memory.apply(owner, { ...request, changeId: first }, [undo], undo);
  assert.equal(retargetedRetry.changed, false, 'one current undo message must not undo two changes');
  assert.equal((await memory.view(owner)).commitments[0].title, 'Final proposal');
});

test('deadline-only changes preserve title and no-op receipts stay idempotent after undo', async () => {
  const { memory, path, taskId } = await setup();
  const correction = source('2', 'Set deadline to September 20 at noon UTC.');
  const request = { kind: 'correct' as const, taskId, deadline: { kind: 'instant' as const, at: '2026-09-20T12:00:00Z' }, evidence: [ref(correction)] };
  await memory.apply(owner, request, [correction], correction);
  assert.equal((await memory.view(owner)).commitments[0].title, 'Send proposal');
  const repeat = source('3', 'Keep that same deadline.');
  const noOp = { ...request, evidence: [ref(repeat)] };
  assert.equal((await memory.apply(owner, noOp, [repeat], repeat)).changed, false);
  const view = await memory.view(owner);
  assert.equal(view.mutations?.length, 1);
  assert.equal(view.changes.length, 2);
  const undo = source('4', 'Undo the deadline change.');
  await memory.apply(owner, { kind: 'undo', changeId: view.mutations![0].changeId, evidence: [ref(undo)] }, [undo], undo);
  assert.equal((await new PersonalMemory(path).apply(owner, noOp, [repeat], repeat)).changed, false);
  assert.deepEqual((await memory.view(owner)).commitments[0].deadline, { kind: 'date', date: '2026-09-18', timezone: 'Asia/Singapore' });
});

test('undo ordering spans tasks rather than selecting the last change per task', async () => {
  const { memory, taskId } = await setup();
  const secondSource = source('2', "I'll review the contract.");
  const second = await memory.apply(owner, { kind: 'commitment', title: 'Review contract', deadline: { kind: 'unknown' },
    evidence: [ref(secondSource)] }, [secondSource]);
  const firstDone = source('3', 'Proposal complete.');
  await memory.apply(owner, { kind: 'complete', taskId, evidence: [ref(firstDone)] }, [firstDone], firstDone);
  const secondDone = source('4', 'Contract complete.');
  await memory.apply(owner, { kind: 'complete', taskId: second.item.id, evidence: [ref(secondDone)] }, [secondDone], secondDone);
  const undo = source('5', 'Undo.');
  const view = await memory.view(owner);
  await assert.rejects(memory.apply(owner, { kind: 'undo', changeId: view.mutations![0].changeId, evidence: [ref(undo)] }, [undo], undo), /latest/i);
  assert.deepEqual((await memory.view(owner)).commitments.map(task => task.status), ['completed', 'completed']);
});

test('foreign workspace and user cannot mutate a task or undo its change', async () => {
  const { memory, taskId } = await setup();
  const done = source('2', 'Complete it.');
  await memory.apply(owner, { kind: 'complete', taskId, evidence: [ref(done)] }, [done], done);
  const changeId = (await memory.view(owner)).mutations![0].changeId;
  for (const stranger of [{ ...owner, workspaceId: 'other' }, { ...owner, userId: 'jo' }]) {
    const request = source('3', 'Change it.', stranger.userId);
    await assert.rejects(memory.apply(stranger, { kind: 'correct', taskId, title: 'Stolen', evidence: [ref(request)] }, [request], request), /not found/i);
    await assert.rejects(memory.apply(stranger, { kind: 'undo', changeId, evidence: [ref(request)] }, [request], request), /not found/i);
    assert.equal((await memory.view(stranger)).mutations, undefined);
  }
});

test('legacy state remains readable and stale undo leaves disk untouched', async () => {
  const { memory, path, taskId } = await setup();
  assert.equal((await new PersonalMemory(path).view(owner)).mutations, undefined);
  const correction = source('2', 'Rename to Final proposal.');
  await memory.apply(owner, { kind: 'correct', taskId, title: 'Final proposal', evidence: [ref(correction)] }, [correction], correction);
  const changeId = (await memory.view(owner)).mutations![0].changeId;
  const state = JSON.parse(await readFile(path, 'utf8'));
  state.people[0].items[0].title = 'Newer external title';
  await writeFile(path, JSON.stringify(state));
  const before = await readFile(path, 'utf8');
  const undo = source('3', 'Undo.');
  await assert.rejects(memory.apply(owner, { kind: 'undo', changeId, evidence: [ref(undo)] }, [undo], undo), /stale/i);
  assert.equal(await readFile(path, 'utf8'), before);
});
