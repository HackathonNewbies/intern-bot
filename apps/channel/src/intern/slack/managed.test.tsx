import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startChannelsWithGatewayControl } from '@copilotkit/channels-intelligence';
import { z } from 'zod';
import { ManagedGateway, preparedDelivery } from '../../testing/managed-gateway';
import { createInternApp } from './app';

test('real managed Slack renders private home, routes a later click, and redirects a public mention', async () => {
  const app = createInternApp({ name: 'support', dataDir: await mkdtemp(join(tmpdir(), 'intern-managed-')) });
  const gateway = new ManagedGateway();
  const handle = await startChannelsWithGatewayControl([app.channel], { session: gateway, scope: { projectId: 1, channelName: 'support' }, runtimeInstanceId: 'rti_intern', loadHistory: async () => [], runCanonical: async () => { throw new Error('UI commands must not invoke a model'); } });
  try {
    const base = preparedDelivery('intern_home', 'slack', { kind: 'text', text: 'start' });
    const home = { ...base, tenant: { id: 'T1' }, conversation: { id: 'D1', kind: 'im' }, turn: { ...base.turn, actor: { externalUserId: 'U1', kind: 'human' as const } } };
    await gateway.deliver(home);
    const card = gateway.packets.map(p => p.payload).find(p => p.kind === 'slack.message.create');
    assert.ok(card, JSON.stringify(gateway.packets));
    assert.match(JSON.stringify(card), /Refresh briefing/);
    const buttons = z.array(z.object({ type: z.string(), elements: z.array(z.unknown()).optional() })).parse(card.blocks).flatMap(block => block.type === 'actions' ? block.elements ?? [] : []).map(element => z.object({ text: z.object({ text: z.string() }), action_id: z.string() }).parse(element));
    const demo = buttons.find(button => button.text.text === 'Example briefing')!;
    const click = preparedDelivery('intern_demo_click', 'slack', { kind: 'interaction', actionId: demo.action_id, messageRef: { id: 'pref_v1_home_message_123' } });
    await gateway.deliver({ ...home, deliveryId: click.deliveryId, turn: { ...click.turn, actor: home.turn.actor } });
    assert.match(JSON.stringify(gateway.packets), /Fictional data/);
    const before = gateway.packets.length;
    const publicMessage = preparedDelivery('intern_public', 'slack', { kind: 'text', text: 'brief', operation: { kind: 'created', logicalMessageId: 'pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ', revisionId: 'pid_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq', mentioned: true } });
    await gateway.deliver({ ...publicMessage, tenant: { id: 'T1' }, conversation: { id: 'C1', kind: 'channel' }, turn: { ...publicMessage.turn, actor: home.turn.actor } });
    const publicEffects = gateway.packets.slice(before).map(p => p.payload);
    assert.equal(publicEffects.some(p => p.kind === 'slack.message.create'), false);
    assert.ok(publicEffects.some(p => p.kind === 'slack.message.ephemeral'));
  } finally { await handle.stop(); }
});
