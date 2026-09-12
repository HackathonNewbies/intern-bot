/** Isolated manual Slack test. Run from repo root with .env; never alongside
 * another listener using the same CHANNEL_CODE. Does not change channel.tsx. */
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createChannel } from '@copilotkit/channels';
import { CopilotKitIntelligence, CopilotRuntime } from '@copilotkit/runtime/v2';
import { createCopilotNodeListener } from '@copilotkit/runtime/v2/node';
import { makeAgent } from 'agent-core';
import { ChannelRunAgent } from '../../agent';
import { required } from '../../env';
import { PersonalMemory } from './store';
import { MessageSchema, type SourceMessage } from './model';
import { createMemoryTools, PERSONAL_MEMORY_INSTRUCTIONS } from './tools';
import { identifyMemoryTestUser, parseMemoryTestUser, TestPairingSchema } from './slack-test-scope';

const memory = new PersonalMemory(resolve('.data/memory-slack-test.json'));
const channelCode = required('CHANNEL_CODE');
const pairingPath = '.data/memory-test-pairing.json';
const pairing = channelCode === 'intern-memory-test' && existsSync(pairingPath)
  ? TestPairingSchema.parse(JSON.parse(readFileSync(pairingPath, 'utf8'))) : undefined;
const channel = createChannel({
  name: channelCode, identifyUser: ctx => identifyMemoryTestUser(ctx, pairing),
  agent: threadId => new ChannelRunAgent(id => makeAgent(id, {
    workplace: false,
    prompt: PERSONAL_MEMORY_INSTRUCTIONS + '\nThis is a manual DM test. Use read_personal_memory and record_personal_memory. Process the newest explicit statement, reuse stored evidence and IDs, then respond concisely. Default timezone: Asia/Singapore.',
  }), threadId),
});

const respond: Parameters<typeof channel.onMessage>[0] = async ({ thread, message }) => {
  if (message.actor.kind !== 'human') return;
  // Capture only a candidate. A local operator must verify its Slack DM and
  // explicitly create the pairing file; a chat message never grants access.
  if (channelCode === 'intern-memory-test' && !pairing && message.platform === 'slack'
    && process.env.MEMORY_PAIRING_PROBE && message.text === process.env.MEMORY_PAIRING_PROBE) {
    mkdirSync('.data', { recursive: true });
    writeFileSync('.data/memory-test-candidate.json', JSON.stringify({ userId: message.actor.id, conversationId: thread.conversationKey }), { mode: 0o600, flag: 'wx' });
    await thread.post('Test thread detected. Waiting for local approval; personal memory is still locked.');
    return;
  }
  if (!message.user) {
    await thread.post(pairing ? 'This test is limited to the paired user and conversation. Use the same message surface where you sent the successful pairing message; nested reply threads may have different IDs.' : 'Cannot verify private DM identity from the provider metadata. Personal memory is locked until a local operator verifies and pairs this test conversation.');
    return;
  }
  const identity = parseMemoryTestUser(message.user.id);
  const owner = { workspaceId: identity.workspaceId, userId: identity.userId };
  if (owner.userId !== message.actor.id) throw new Error('Authenticated owner mismatch');
  // A conversation link is used when the managed provider does not expose an
  // actual Slack message permalink. Never pretend an opaque ref is a Slack ts.
  const url = `https://app.slack.com/client/${encodeURIComponent(owner.workspaceId)}/${encodeURIComponent(identity.channelId)}`;
  const messages = await thread.getMessages();
  const sources: SourceMessage[] = [];
  for (const entry of messages) {
    if (entry.isBot || entry.providerMessage?.deleted) continue;
    const author = entry.providerMessage?.actor ?? entry.user;
    if (!author || author.kind !== 'human') continue;
    const rawTime = entry.providerMessage?.occurredAt ?? entry.ts;
    const time = rawTime && /^\d{10}(\.\d+)?$/.test(rawTime) ? new Date(Number(rawTime) * 1000).toISOString() : rawTime;
    const parsed = MessageSchema.safeParse({ threadId: identity.channelId,
      messageId: entry.providerMessage?.logicalMessageId ?? entry.messageRef?.id ?? entry.ts,
      authorId: author.id, sentAt: time, text: entry.text, url });
    if (parsed.success) sources.push(parsed.data);
  }
  const currentId = message.operation.logicalMessageId;
  if (message.operation.kind === 'deleted') {
    await thread.post('Message deletion reconciliation is not supported by this test yet. Existing memory was left unchanged.');
    return;
  }
  // The inbound message is authenticated even if history capability is absent.
  if (!sources.some(source => source.messageId === currentId)) {
    sources.push({ threadId: identity.channelId, messageId: currentId,
      authorId: owner.userId, sentAt: new Date().toISOString(), text: message.text, url });
  }
  const previous = await memory.view(owner);
  const oldEvidence = [...previous.commitments, ...previous.blockers, ...previous.questions]
    .flatMap(item => [...item.evidence, ...(item.resolutionEvidence ?? []), ...(item.mutationEvidence ?? [])]);
  const allowed = [...new Map([...oldEvidence, ...sources].map(source => [JSON.stringify([source.threadId, source.messageId]), source])).values()];
  const { tools } = createMemoryTools(memory, async ctx => {
    if (ctx.user?.id !== message.user!.id || ctx.actor.id !== owner.userId) throw new Error('Private memory scope mismatch');
    return { owner, sources: allowed, currentSource: { threadId: identity.channelId, messageId: currentId } };
  });
  await thread.runAgent({ tools, context: [
    { description: 'Current date and timezone', value: `${new Date().toISOString()}; Asia/Singapore` },
    { description: 'Authenticated memory owner', value: owner.userId },
    { description: 'Current request source', value: JSON.stringify({ threadId: identity.channelId, messageId: currentId }) },
    { description: 'Test source limits', value: 'Sources are this DM history plus evidence already saved for this owner. URLs open the DM, not necessarily the exact message. Source edits and deletion reconciliation are not implemented.' },
  ] });
};
channel.onMention(respond);
channel.onMessage(respond);

const intelligence = new CopilotKitIntelligence({ apiKey: required('INTELLIGENCE_API_KEY') });
const runtime = new CopilotRuntime({ agents: {}, intelligence, channels: [channel] });
const listener = createCopilotNodeListener({ runtime, basePath: '/api/copilotkit' });
const server = createServer(listener);
const stop = async () => { await listener.channels.stop(); if (server.listening) server.close(); };
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
try {
  await listener.channels.ready({ timeoutMs: 30000 });
  if (listener.channels.status().overall !== 'online') throw new Error('Channel not online; finish the CopilotKit Slack setup.');
  server.listen(Number(process.env.MEMORY_TEST_PORT ?? 3001), () => {
    console.log('Memory test online. Open a one-to-one DM with your Slack bot. Ctrl+C stops this listener.');
  });
} catch {
  console.error('Memory test could not connect. Check the model/Intelligence settings and Channel setup; credentials are not printed.');
  await stop();
  process.exitCode = 1;
}
