import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonalMemory } from './store';
import type { Observation, SourceMessage } from './model';

const owner = { workspaceId: 'fictional-workspace', userId: 'alex' };
const sales: SourceMessage = {
  threadId: 'sales', messageId: 'same-id', authorId: 'alex',
  sentAt: '2026-09-14T09:00:00+08:00',
  text: "I'll send the Acme proposal.", url: 'https://example.invalid/sales/same-id',
};
const design: SourceMessage = {
  threadId: 'design', messageId: 'same-id', authorId: 'alex',
  sentAt: '2026-09-14T09:10:00+08:00',
  text: "I'll review the Beta design.", url: 'https://example.invalid/design/same-id',
};
const ref = (source: SourceMessage) => ({ threadId: source.threadId, messageId: source.messageId, quote: source.text });
const promise = (source: SourceMessage): Observation => ({
  kind: 'commitment', title: source.text, deadline: { kind: 'unknown' }, evidence: [ref(source)],
});
async function setup() {
  const path = join(await mkdtemp(join(tmpdir(), 'intern-evidence-')), 'state.json');
  return { path, memory: new PersonalMemory(path) };
}

// Catches source identity/deduplication accidentally reduced to messageId alone.
test('identical message IDs in different threads retain separate commitments and provenance', async () => {
  const { path, memory } = await setup();
  const first = await memory.apply(owner, promise(sales), [sales, design]);
  const second = await memory.apply(owner, promise(design), [sales, design]);
  assert.notEqual(first.item.id, second.item.id);
  const view = await new PersonalMemory(path).view(owner);
  assert.deepEqual(view.commitments.map(item => [item.evidence[0].threadId, item.evidence[0].url]), [
    ['sales', 'https://example.invalid/sales/same-id'],
    ['design', 'https://example.invalid/design/same-id'],
  ]);
  assert.equal(view.changes.length, 2);
});

// Catches ignoring threadId when looking up an otherwise valid ID and quote.
test('a wrong-thread reference cannot reuse an authorized message ID and quote', async () => {
  const { path, memory } = await setup();
  await memory.apply(owner, promise(sales), [sales]);
  const before = await readFile(path, 'utf8');
  await assert.rejects(memory.apply(owner, {
    ...promise(sales), evidence: [{ ...ref(sales), threadId: 'unselected' }],
  }, [sales]), /evidence/);
  assert.equal(await readFile(path, 'utf8'), before);
});

// Catches partial persistence or short-circuit validation on an already-known source.
test('mixed valid and fabricated evidence rejects atomically even on a replay', async () => {
  const { path, memory } = await setup();
  await memory.apply(owner, promise(sales), [sales]);
  const before = await readFile(path, 'utf8');
  for (const invalid of [
    { ...ref(sales), quote: 'Fabricated promise' },
    { ...ref(design), messageId: 'missing' },
  ]) {
    await assert.rejects(memory.apply(owner, {
      ...promise(sales), evidence: [ref(sales), invalid],
    }, [sales, design]), /quote|evidence/);
    assert.equal(await readFile(path, 'utf8'), before);
  }
  assert.equal((await memory.apply(owner, promise(design), [sales, design])).changed, true);
  assert.equal((await memory.view(owner)).commitments.length, 2);
});

// Catches validating only one duplicate source candidate instead of rejecting ambiguity.
test('conflicting transport messages with the same thread and ID cannot alter existing memory', async () => {
  const { path, memory } = await setup();
  await memory.apply(owner, promise(design), [design]);
  const before = await readFile(path, 'utf8');
  await assert.rejects(memory.apply(owner, promise(sales), [
    sales, { ...sales, text: 'An edited, conflicting source.', authorId: 'jo' },
  ]), /ambiguous/);
  assert.equal(await readFile(path, 'utf8'), before);
});

// Catches replay identity depending on paraphrase/order and losing acknowledged state on restart.
test('clarification replay preserves its identity and acknowledgement across restart', async () => {
  const { path, memory } = await setup();
  const question: Observation = {
    kind: 'clarification', question: 'Which project does the approval concern?',
    evidence: [ref(sales), ref(design)],
  };
  const recorded = await memory.apply(owner, question, [sales, design]);
  await memory.acknowledge(owner, (await memory.view(owner)).changes.map(change => change.id));
  const restarted = new PersonalMemory(path);
  const replay = await restarted.apply(owner, {
    ...question, question: 'Is this approval about Acme or Beta?',
    evidence: [ref(design), ref(sales), ref(design)],
  }, [sales, design]);
  assert.equal(replay.changed, false);
  assert.equal(replay.item.id, recorded.item.id);
  const view = await restarted.view(owner);
  assert.equal(view.questions.length, 1);
  assert.equal(view.questions[0].title, 'Which project does the approval concern?');
  assert.equal(view.questions[0].evidence.length, 2);
  assert.equal(view.changes.length, 0);
  assert.equal(view.commitments.length, 0);
  assert.equal(view.blockers.length, 0);
});
