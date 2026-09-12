import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ChannelToolContext } from '@copilotkit/channels';
import { createMemoryTools } from './tools';
import { PersonalMemory } from './store';
import { z } from 'zod';
import { ItemSchema } from './model';
const mutationResult = z.object({ item: ItemSchema, changed: z.boolean() });

const owner = { workspaceId: 'demo', userId: 'alex' };
const sources = [
  { threadId: 'sales', messageId: '1', authorId: 'alex', text: "I'll send the Acme proposal after pricing approval.",
    sentAt: '2026-09-14T09:00:00+08:00', url: 'https://example.invalid/1' },
  { threadId: 'pricing', messageId: '2', authorId: 'priya', text: 'Acme pricing approval is pending.',
    sentAt: '2026-09-14T10:00:00+08:00', url: 'https://example.invalid/2' },
  { threadId: 'pricing', messageId: '3', authorId: 'priya', text: 'Acme pricing is approved.',
    sentAt: '2026-09-14T11:00:00+08:00', url: 'https://example.invalid/3' },
];
const context = { user: { id: 'canonical-alex' }, actor: { id: 'alex', kind: 'human' }, platform: 'slack' } as ChannelToolContext;
const ref = (i: number) => ({ threadId: sources[i].threadId, messageId: sources[i].messageId, quote: sources[i].text });

test('CopilotKit tool handlers persist a complete commitment/blocker/resolution interaction', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'intern-tools-')), 'state.json');
  const memory = new PersonalMemory(path);
  let available = sources.slice(0, 2);
  const { read, record } = createMemoryTools(memory, async () => ({ owner, sources: available }));
  const task = mutationResult.parse(await record.handler({ observation: { kind: 'commitment', title: 'Send Acme proposal',
    deadline: { kind: 'unknown' }, evidence: [ref(0)] } }, context));
  const blocker = mutationResult.parse(await record.handler({ observation: { kind: 'blocker', title: 'Await pricing approval',
    taskId: task.item.id, evidence: [ref(0), ref(1)] } }, context));
  await assert.rejects(async () => record.handler({ observation: { kind: 'resolve', blockerId: blocker.item.id,
    evidence: [ref(2)] } }, context), /evidence/);
  available = sources;
  await record.handler({ observation: { kind: 'resolve', blockerId: blocker.item.id, evidence: [ref(2)] } }, context);
  const result = z.object({ memory: z.object({ commitments: z.array(ItemSchema), blockers: z.array(ItemSchema) }) }).parse(await read.handler({}, context));
  assert.equal(result.memory.commitments[0].status, 'open');
  assert.equal(result.memory.blockers[0].status, 'resolved');
  assert.equal((await new PersonalMemory(path).view(owner)).changes.length, 3);
});

test('tools reject anonymous and mismatched actors before exposing personal memory', async () => {
  const memory = new PersonalMemory(join(await mkdtemp(join(tmpdir(), 'intern-tools-')), 'state.json'));
  let scopeCalls = 0;
  const { read, record } = createMemoryTools(memory, async () => { scopeCalls++; return { owner, sources }; });
  const observation = { kind: 'commitment' as const, title: 'Send Acme proposal',
    deadline: { kind: 'unknown' as const }, evidence: [ref(0)] };
  for (const denied of [
    { ...context, user: null },
    { ...context, platform: 'discord' },
    { ...context, actor: { id: 'alex', kind: 'bot' as const } },
  ]) {
    await assert.rejects(async () => read.handler({}, denied), /authenticated/);
    await assert.rejects(async () => record.handler({ observation }, denied), /authenticated/);
  }
  assert.equal(scopeCalls, 0, 'unauthenticated callers must not reach source resolution');
  const wrongActor = { ...context, actor: { id: 'jo', kind: 'human' as const } };
  await assert.rejects(async () => read.handler({}, wrongActor), /owner/);
  await assert.rejects(async () => record.handler({ observation }, wrongActor), /owner/);
  assert.equal((await memory.view(owner)).commitments.length, 0);
  assert.equal(read.parameters.safeParse({ owner }).success, false);
  assert.equal(record.parameters.safeParse({ observation, owner }).success, false);
  assert.equal(record.parameters.safeParse({ observation, sources }).success, false);
});
