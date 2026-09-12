import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonalMemory } from './store';
import type { SourceMessage } from './model';

const owner = { workspaceId: 'demo', userId: 'alex' };
const message = (messageId: string, text: string): SourceMessage => ({ threadId: 'dm', messageId, authorId: 'alex', text,
  sentAt: '2026-09-14T09:00:00Z', url: 'https://example.invalid/message' });
const ref = (s: SourceMessage) => ({ threadId: s.threadId, messageId: s.messageId, quote: s.text });
async function setup() {
  const path = join(await mkdtemp(join(tmpdir(), 'memory-matching-')), 'state.json');
  const memory = new PersonalMemory(path);
  const add = async (title: string, id: string) => {
    const s = message(id, `I will ${title}.`);
    return memory.apply(owner, { kind: 'commitment', title, deadline: { kind: 'unknown' }, evidence: [ref(s)] }, [s]);
  };
  return { path, memory, add };
}
test('ambiguous completion and correction reject without changing either similarly named task', async () => {
  const { path, memory, add } = await setup();
  const acme = await add('Send Acme proposal', '1');
  await add('Send Beta proposal', '2');
  const before = await readFile(path, 'utf8');
  const s = message('3', 'The proposal is done.');
  await assert.rejects(memory.apply(owner, { kind: 'complete', taskId: acme.item.id, evidence: [ref(s)] }, [s], s), /clarif/i);
  await assert.rejects(memory.apply(owner, { kind: 'correct', taskId: acme.item.id, title: 'New proposal', evidence: [ref(s)] }, [s], s), /clarif/i);
  assert.equal(await readFile(path, 'utf8'), before);
});
test('current message must select the requested task, not merely include old specific evidence', async () => {
  const { memory, add } = await setup();
  const acme = await add('Send Acme proposal', '1');
  const beta = await add('Send Beta proposal', '2');
  const s = message('3', 'The Acme proposal is done.');
  await assert.rejects(memory.apply(owner, { kind: 'complete', taskId: beta.item.id, evidence: [ref(s)] }, [s], s), /clarif/i);
  assert.equal((await memory.apply(owner, { kind: 'complete', taskId: acme.item.id, evidence: [ref(s)] }, [s], s)).item.status, 'completed');
  const vague = message('4', 'The proposal is done.');
  await assert.rejects(memory.apply(owner, { kind: 'complete', taskId: beta.item.id, evidence: [ref(s), ref(vague)] }, [s, vague], vague), /clarif/i);
  const explicit = message('5', `Complete task ${beta.item.id}`);
  assert.equal((await memory.apply(owner, { kind: 'complete', taskId: beta.item.id, evidence: [ref(explicit)] }, [explicit], explicit)).item.status, 'completed');
});
test('new source with normalized duplicate title rejects without merging deadlines or creating notices', async () => {
  const { memory, path, add } = await setup();
  const original = await add('Send Acme proposal', '1');
  const before = await readFile(path, 'utf8');
  await assert.rejects(add(' SEND  ACME—PROPOSAL! ', '2'), /duplicate|already|clarif/i);
  assert.equal(await readFile(path, 'utf8'), before);
  assert.equal((await add('Send Acme proposal', '1')).changed, false, 'same-source retry still works');
  assert.equal((await memory.view(owner)).commitments[0].id, original.item.id);
  await add('Send Beta proposal', '3');
  assert.equal((await memory.view(owner)).commitments.length, 2);
});
test('renaming a task to another task name is blocked', async () => {
  const { memory, add } = await setup();
  const a = await add('Send Acme proposal', '1');
  await add('Send Beta proposal', '2');
  const s = message('3', `Rename task ${a.item.id} to Send Beta proposal`);
  await assert.rejects(memory.apply(owner, { kind: 'correct', taskId: a.item.id, title: 'Send Beta proposal', evidence: [ref(s)] }, [s], s), /duplicate|already|clarif/i);
});
test('two named targets and partial-word matches cannot authorize a guessed task', async () => {
  const { memory, add } = await setup();
  const a = await add('Send Acme proposal', '1');
  const b = await add('Send Beta proposal', '2');
  for (const [id, text] of [['3', 'Acme and Beta proposals are done.'], ['4', 'AcmeExtra proposal done.'], ['5', `Complete either ${a.item.id} or ${b.item.id}`]]) {
    const s = message(id, text);
    await assert.rejects(memory.apply(owner, { kind: 'complete', taskId: a.item.id, evidence: [ref(s)] }, [s], s), /clarif/i);
  }
  assert.ok((await memory.view(owner)).commitments.every(t => t.status === 'open'));
});
test('undo cannot restore a title reused by a different task', async () => {
  const { memory, add, path } = await setup();
  const a = await add('Acme proposal', '1');
  const s = message('2', 'Rename Acme proposal to Acme final proposal.');
  await memory.apply(owner, { kind: 'correct', taskId: a.item.id, title: 'Acme final proposal', evidence: [ref(s)] }, [s], s);
  const changeId = (await memory.view(owner)).mutations![0].changeId;
  await add('Acme proposal', '3');
  const before = await readFile(path, 'utf8');
  const undo = message('4', 'Undo the rename.');
  await assert.rejects(memory.apply(owner, { kind: 'undo', changeId, evidence: [ref(undo)] }, [undo], undo), /duplicate|already/i);
  assert.equal(await readFile(path, 'utf8'), before);
});
test('duplicate protection is owner-scoped and includes completed tasks', async () => {
  const { memory, add } = await setup();
  const a = await add('Acme proposal', '1');
  const done = message('2', 'Acme proposal done.');
  await memory.apply(owner, { kind: 'complete', taskId: a.item.id, evidence: [ref(done)] }, [done], done);
  await assert.rejects(add('Acme proposal', '3'), /duplicate|already/i);
  const other = { ...owner, userId: 'jo' };
  const s = { ...message('4', 'I will send Acme proposal.'), authorId: 'jo' };
  assert.equal((await memory.apply(other, { kind: 'commitment', title: 'Acme proposal', deadline: { kind: 'unknown' }, evidence: [ref(s)] }, [s])).changed, true);
});
