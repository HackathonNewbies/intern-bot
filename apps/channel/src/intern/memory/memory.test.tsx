import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonalMemory } from './store';

const owner = { workspaceId: 'demo-workspace', userId: 'alex' };
const other = { workspaceId: 'demo-workspace', userId: 'jo' };
const messages = [
  { threadId: 'proposal', messageId: '1', authorId: 'alex', sentAt: '2026-09-14T09:00:00+08:00',
    text: "I'll send the Acme proposal Friday. It needs pricing approval first.", url: 'https://example.invalid/messages/1' },
  { threadId: 'pricing', messageId: '2', authorId: 'jo', sentAt: '2026-09-14T09:10:00+08:00',
    text: 'Pricing approval for the Acme proposal is still pending.', url: 'https://example.invalid/messages/2' },
  { threadId: 'pricing', messageId: '3', authorId: 'priya', sentAt: '2026-09-14T11:00:00+08:00',
    text: 'I approved pricing for the Acme proposal.', url: 'https://example.invalid/messages/3' },
];
const evidence = (i: number) => ({ threadId: messages[i].threadId, messageId: messages[i].messageId, quote: messages[i].text });
const commitment = { kind: 'commitment' as const, title: 'Send Acme proposal',
  deadline: { kind: 'date' as const, date: '2026-09-18', timezone: 'Asia/Singapore' }, evidence: [evidence(0)] };
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'intern-memory-'));
  const path = join(dir, 'memory.json');
  return { path, memory: new PersonalMemory(path) };
}

test('resolution survives restart without completing the dependent commitment', async () => {
  const { path, memory } = await setup();
  const task = await memory.apply(owner, commitment, messages);
  const blocker = await memory.apply(owner, { kind: 'blocker', title: 'Await pricing approval', taskId: task.item.id,
    evidence: [evidence(0), evidence(1)] }, messages);
  await memory.apply(owner, { kind: 'resolve', blockerId: blocker.item.id, evidence: [evidence(2)] }, messages);
  const view = await new PersonalMemory(path).view(owner);
  assert.equal(view.commitments[0].status, 'open');
  assert.deepEqual(view.commitments[0].deadline, { kind: 'date', date: '2026-09-18', timezone: 'Asia/Singapore' });
  assert.equal(view.blockers[0].status, 'resolved');
  assert.equal(view.blockers[0].taskId, task.item.id);
  assert.equal(view.blockers[0].resolutionEvidence?.[0].authorId, 'priya');
  assert.equal(view.blockers[0].evidence.length, 2);
  assert.equal(view.changes.length, 3);
});

test('repeated and concurrent reads do not duplicate state or follow-up changes', async () => {
  const { path, memory } = await setup();
  await Promise.all([memory.apply(owner, commitment, messages), new PersonalMemory(path).apply(owner, { ...commitment, title: 'Paraphrased proposal' }, messages)]);
  const view = await memory.view(owner);
  assert.equal(view.commitments.length, 1);
  assert.equal(view.changes.length, 1);
  await memory.acknowledge(owner, [view.changes[0].id]);
  assert.equal((await new PersonalMemory(path).view(owner)).changes.length, 0);
  await memory.apply(owner, commitment, messages);
  assert.equal((await memory.view(owner)).changes.length, 0);
});

test('duplicate source refs and different excerpts do not create another observation', async () => {
  const { path, memory } = await setup();
  const task = await memory.apply(owner, { ...commitment, evidence: [evidence(0), evidence(0)] }, messages);
  assert.equal(task.item.evidence.length, 1);
  const replay = await new PersonalMemory(path).apply(owner, {
    ...commitment, evidence: [{ ...evidence(0), quote: "I'll send the Acme proposal Friday." }],
  }, messages);
  assert.equal(replay.changed, false);
  assert.equal(replay.item.id, task.item.id);
  const blocker = await memory.apply(owner, { kind: 'blocker', title: 'Await pricing approval', taskId: task.item.id,
    evidence: [evidence(1), evidence(0), evidence(1)] }, messages);
  const repeatedBlocker = await memory.apply(owner, { kind: 'blocker', title: 'Rephrased dependency', taskId: task.item.id,
    evidence: [evidence(0), evidence(1)] }, messages);
  assert.equal(repeatedBlocker.changed, false);
  assert.equal(repeatedBlocker.item.id, blocker.item.id);
  const view = await memory.view(owner);
  assert.equal(view.commitments.length, 1);
  assert.equal(view.blockers.length, 1);
  assert.equal(view.changes.length, 2);
});

test('replayed resolutions preserve original evidence and never requeue acknowledged changes', async () => {
  const { path, memory } = await setup();
  const task = await memory.apply(owner, commitment, messages);
  const blocker = await memory.apply(owner, { kind: 'blocker', title: 'Await pricing approval', taskId: task.item.id,
    evidence: [evidence(0), evidence(1)] }, messages);
  const resolution = { kind: 'resolve' as const, blockerId: blocker.item.id, evidence: [evidence(2)] };
  assert.equal((await memory.apply(owner, resolution, messages)).changed, true);
  await memory.acknowledge(owner, (await memory.view(owner)).changes.map(change => change.id));
  const restarted = new PersonalMemory(path);
  assert.equal((await restarted.apply(owner, resolution, messages)).changed, false);
  assert.equal((await restarted.apply(owner, { ...resolution, evidence: [evidence(2), evidence(2)] }, messages)).changed, false);
  const later = { ...messages[2], messageId: '4', sentAt: '2026-09-14T12:00:00+08:00', text: 'Approval reconfirmed.' };
  assert.equal((await restarted.apply(owner, { ...resolution, evidence: [{ threadId: later.threadId,
    messageId: later.messageId, quote: later.text }] }, [later])).changed, false);
  const view = await restarted.view(owner);
  assert.equal(view.commitments[0].status, 'open');
  assert.equal(view.blockers[0].resolutionEvidence?.[0].messageId, messages[2].messageId);
  assert.equal(view.changes.length, 0);
});

test('invalid links and stale resolutions leave disk untouched and do not poison later writes', async () => {
  const { path, memory } = await setup();
  const task = await memory.apply(owner, commitment, messages);
  const beforeBlocker = await readFile(path, 'utf8');
  await assert.rejects(memory.apply(owner, { kind: 'blocker', title: 'Missing task evidence', taskId: task.item.id,
    evidence: [evidence(1)] }, messages), /commitment evidence/);
  assert.equal(await readFile(path, 'utf8'), beforeBlocker);
  const blocker = await memory.apply(owner, { kind: 'blocker', title: 'Await pricing approval', taskId: task.item.id,
    evidence: [evidence(0), evidence(1)] }, messages);
  const beforeResolution = await readFile(path, 'utf8');
  await assert.rejects(memory.apply(owner, { kind: 'resolve', blockerId: blocker.item.id,
    evidence: [evidence(1)] }, messages), /newer evidence/);
  assert.equal(await readFile(path, 'utf8'), beforeResolution);
  assert.equal((await memory.apply(owner, { kind: 'resolve', blockerId: blocker.item.id,
    evidence: [evidence(2)] }, messages)).changed, true);
});

test('cannot turn another author’s message into the owner’s commitment or access their state', async () => {
  const { memory } = await setup();
  await assert.rejects(memory.apply(other, commitment, messages), /owner-authored/);
  const task = await memory.apply(owner, commitment, messages);
  assert.equal((await memory.view(other)).commitments.length, 0);
  assert.equal((await memory.view({ ...owner, workspaceId: 'another-workspace' })).commitments.length, 0);
  await assert.rejects(memory.apply(other, { kind: 'blocker', title: 'Steal task', taskId: task.item.id, evidence: [evidence(1)] }, messages), /not found/);
  const blocker = await memory.apply(owner, { kind: 'blocker', title: 'Await pricing approval', taskId: task.item.id,
    evidence: [evidence(0), evidence(1)] }, messages);
  await assert.rejects(memory.apply(other, { kind: 'resolve', blockerId: blocker.item.id, evidence: [evidence(2)] }, messages), /not found/);
  const view = await memory.view(owner);
  await memory.acknowledge(other, view.changes.map(change => change.id));
  assert.deepEqual(await memory.view(owner), view);
});

test('unknown evidence, fabricated quotes and unsupported links cannot create state', async () => {
  const { memory } = await setup();
  await assert.rejects(memory.apply(owner, { ...commitment, evidence: [{ ...evidence(0), messageId: 'fake' }] }, messages), /evidence/);
  await assert.rejects(memory.apply(owner, { ...commitment, evidence: [{ ...evidence(0), quote: 'Invented promise' }] }, messages), /quote/);
  await assert.rejects(memory.apply(owner, commitment, [{ ...messages[0], url: 'javascript:alert(1)' }]), /https/);
  await assert.rejects(memory.apply(owner, commitment, [messages[0], messages[0]]), /ambiguous/);
  assert.equal((await memory.view(owner)).commitments.length, 0);
});

test('uncertainty is retained as a question and empty input does not resolve work', async () => {
  const { memory } = await setup();
  await memory.apply(owner, { kind: 'clarification', question: 'Does this approval concern your Acme proposal?', evidence: [evidence(2)] }, messages);
  const view = await memory.view(owner);
  assert.equal(view.questions.length, 1);
  assert.equal(view.blockers.length, 0);
  await assert.rejects(memory.apply(owner, commitment, []), /evidence/);
  assert.equal((await memory.view(owner)).questions.length, 1);
});

test('corrupt stored data is reported rather than silently overwritten', async () => {
  const { path, memory } = await setup();
  await writeFile(path, '{broken');
  await assert.rejects(memory.apply(owner, commitment, messages));
  assert.equal(await readFile(path, 'utf8'), '{broken');
});
