import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChannelIdentityContext } from '@copilotkit/channels';
import { identifyMemoryTestUser, parseMemoryTestUser } from './slack-test-scope';

const base: ChannelIdentityContext = { provider: 'slack', tenant: { id: 'T123' }, installation: { id: 'test' }, actor: { id: 'U123', kind: 'human' }, conversation: { id: 'D123::123.0', kind: 'thread' }, trigger: 'message', event: {}, raw: {} };
test('memory test admits provider-identified individual DMs only', () => {
  assert.deepEqual(parseMemoryTestUser(identifyMemoryTestUser(base)!.id), { workspaceId: 'T123', userId: 'U123', channelId: 'D123' });
  for (const channelId of ['C123', 'G123', 'opaque']) {
    assert.equal(identifyMemoryTestUser({ ...base, conversation: { id: channelId } }), null);
  }
  assert.equal(identifyMemoryTestUser({ ...base, raw: { event: { channel: 'D123', channel_type: 'mpim' } } }), null);
  assert.equal(identifyMemoryTestUser({ ...base, actor: { id: 'B123', kind: 'bot' } }), null);
  assert.equal(identifyMemoryTestUser({ ...base, tenant: { id: 'unknown' } }), null);
});
const pairing = { channelCode: 'intern-memory-test', workspaceId: 'T123', userId: 'U123', channelId: 'D123', conversationId: 'managed-thread-123' };
const managed = { ...base, tenant: { id: 'unknown' }, conversation: { id: 'managed-thread-123', kind: 'thread' }, raw: { kind: 'text' } };
test('explicit local pairing admits only the pinned managed actor and thread', () => {
  const user = identifyMemoryTestUser(managed, pairing);
  assert.ok(user);
  assert.deepEqual(parseMemoryTestUser(user.id), { workspaceId: 'T123', userId: 'U123', channelId: 'D123' });
  for (const ctx of [
    { ...managed, actor: { id: 'U999', kind: 'human' as const } },
    { ...managed, conversation: { id: 'different-thread' } },
    { ...managed, actor: { id: 'U123', kind: 'bot' as const } },
    { ...managed, provider: 'teams' },
    { ...managed, tenant: { id: 'T999' } },
    { ...managed, raw: { event: { channel: 'C123', channel_type: 'channel' } } },
    { ...managed, raw: { event: { channel: 'D123', channel_type: 'mpim' } } },
    base,
  ]) assert.equal(identifyMemoryTestUser(ctx, pairing), null);
  assert.equal(identifyMemoryTestUser(managed, { ...pairing, channelCode: 'intern-bot' }), null);
  assert.equal(identifyMemoryTestUser(managed, { ...pairing, channelId: 'C123' }), null);
});
test('managed raw Slack event supplies DM identity when conversation ID is opaque', () => {
  const user = identifyMemoryTestUser({ ...base, conversation: { id: 'opaque' }, raw: { event: { channel: 'D456', channel_type: 'im' } } });
  assert.equal(parseMemoryTestUser(user!.id).channelId, 'D456');
});
