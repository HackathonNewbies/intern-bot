import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AbstractAgent } from '@ag-ui/client';
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/core';
import { createChannel } from '@copilotkit/channels';
import { startChannelsWithGatewayControl } from '@copilotkit/channels-intelligence';
import { from, type Observable } from 'rxjs';
import { z } from 'zod';
import { ManagedGateway, preparedDelivery } from '../../testing/managed-gateway';
import { ItemSchema } from './model';
import { PersonalMemory } from './store';
import { createMemoryTools, type ResolveMemoryScope } from './tools';

const owner = { workspaceId: 'demo', userId: 'alex' };
const sources = [
  { threadId: 'sales', messageId: '1', authorId: 'alex', text: "I'll send the Acme proposal after pricing approval.",
    sentAt: '2026-09-14T09:00:00+08:00', url: 'https://example.invalid/1' },
  { threadId: 'pricing', messageId: '2', authorId: 'priya', text: 'Acme pricing approval is pending.',
    sentAt: '2026-09-14T10:00:00+08:00', url: 'https://example.invalid/2' },
  { threadId: 'pricing', messageId: '3', authorId: 'priya', text: 'Acme pricing is approved.',
    sentAt: '2026-09-14T11:00:00+08:00', url: 'https://example.invalid/3' },
];
const ref = (i: number) => ({ threadId: sources[i].threadId, messageId: sources[i].messageId, quote: sources[i].text });
const mutation = z.object({ item: ItemSchema, changed: z.boolean() });
type Call = { name: string; args: unknown };
type Script = (step: number, input: RunAgentInput) => Call | undefined;

/** A deterministic model substitute; Channels still parses and executes tools,
 * sends their results back to this agent, and renders the final Slack response. */
class MemoryScenarioAgent extends AbstractAgent {
  private step = 0;
  constructor(private readonly script: Script) { super(); }
  override clone(): MemoryScenarioAgent {
    const clone = new MemoryScenarioAgent(this.script);
    clone.threadId = this.threadId;
    clone.setMessages([...this.messages]);
    clone.setState(this.state);
    clone.step = this.step;
    return clone;
  }
  run(input: RunAgentInput): Observable<BaseEvent> {
    const call = this.script(this.step++, input);
    const events: BaseEvent[] = [{ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId }];
    if (call) {
      const toolCallId = `memory_${this.step}`;
      events.push(
        { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: call.name },
        { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify(call.args) },
        { type: EventType.TOOL_CALL_END, toolCallId },
      );
    } else {
      events.push(
        { type: EventType.TEXT_MESSAGE_START, messageId: 'memory_reply', role: 'assistant' },
        { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'memory_reply', delta: 'Memory scenario finished.' },
        { type: EventType.TEXT_MESSAGE_END, messageId: 'memory_reply' },
      );
    }
    events.push({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId });
    return from(events);
  }
}

async function runScenario(memory: PersonalMemory, resolveScope: ResolveMemoryScope, script: Script) {
  const gateway = new ManagedGateway();
  const channel = createChannel({
    name: 'support', identifyUser: 'platform',
    agent: () => new MemoryScenarioAgent(script),
    tools: createMemoryTools(memory, resolveScope).tools,
  });
  let failure: unknown;
  channel.onMessage(async ({ thread }) => {
    try { await thread.runAgent(); } catch (error) { failure = error; throw error; }
  });
  const handle = await startChannelsWithGatewayControl([channel], {
    session: gateway, scope: { projectId: 1, channelName: 'support' },
    runtimeInstanceId: 'rti_memory_test', loadHistory: async () => [],
    appApiBaseUrl: 'https://api.example', apiKey: 'cpk-offline-test',
    appApiFetch: async (input) => {
      if (String(input).endsWith('/charge')) return Response.json({ charged: true });
      assert.ok(String(input).endsWith('/transcript'), `Unexpected request: ${input}`);
      return Response.json({ messages: [], truncation: { messageLimit: false, byteLimit: false, omittedMessageCount: 0 } });
    },
    runCanonical: async (args) => args.execute({}, { threadId: args.threadId, runId: args.runId }),
  });
  try {
    const delivery = preparedDelivery('personal_memory', 'slack', { kind: 'text', text: 'Update my work memory.' });
    await gateway.deliver({
      ...delivery,
      turn: { ...delivery.turn, actor: { externalUserId: owner.userId, kind: 'human' } },
    });
    assert.equal(failure, undefined);
    const terminal = gateway.packets.at(-1)?.payload;
    assert.ok(terminal?.kind === 'channel.delivery.terminal');
    assert.equal(terminal.status, 'complete');
  } finally { await handle.stop(); }
}

test('managed Channels tool loop persists a blocker resolution while the commitment stays open', { timeout: 10_000 }, async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'intern-loop-')), 'state.json');
  const memory = new PersonalMemory(path);
  let taskId = '';
  let blockerId = '';
  let scopeCalls = 0;
  await runScenario(memory, async (ctx) => {
    assert.equal(ctx.platform, 'slack');
    assert.equal(ctx.actor.id, owner.userId);
    assert.ok(ctx.user);
    scopeCalls++;
    // Authentication/private-destination/source selection belongs to the real
    // integration's resolver. This fixture grants only fictional selected data.
    return { owner, sources };
  }, (step, input) => {
    const results = input.messages.filter(message => message.role === 'tool');
    assert.equal(results.length, step, 'each tool result must reach the next agent iteration');
    const last = () => JSON.parse(String(results.at(-1)?.content));
    switch (step) {
      case 0: return { name: 'read_personal_memory', args: {} };
      case 1:
        assert.equal(last().memory.commitments.length, 0);
        assert.deepEqual(last().sources, sources);
        return { name: 'record_personal_memory', args: { observation: { kind: 'commitment', title: 'Send Acme proposal', deadline: { kind: 'unknown' }, evidence: [ref(0)] } } };
      case 2:
        taskId = mutation.parse(last()).item.id;
        return { name: 'record_personal_memory', args: { observation: { kind: 'blocker', title: 'Await pricing approval', taskId, evidence: [ref(0), ref(1)] } } };
      case 3:
        blockerId = mutation.parse(last()).item.id;
        return { name: 'record_personal_memory', args: { observation: { kind: 'resolve', blockerId, evidence: [ref(2)] } } };
      case 4:
        assert.equal(mutation.parse(last()).item.status, 'resolved');
        return { name: 'read_personal_memory', args: {} };
      default:
        assert.equal(step, 5);
        assert.equal(last().memory.commitments[0].status, 'open');
        assert.equal(last().memory.blockers[0].status, 'resolved');
        return undefined;
    }
  });
  assert.equal(scopeCalls, 5, 'every read and write must resolve current authorization');
  const view = await new PersonalMemory(path).view(owner);
  assert.equal(view.commitments[0].id, taskId);
  assert.equal(view.commitments[0].status, 'open');
  assert.equal(view.blockers[0].id, blockerId);
  assert.equal(view.blockers[0].resolutionEvidence?.[0].messageId, '3');
  assert.equal(view.changes.length, 3);
});

test('managed Channels returns private-scope denial to the agent without reading or recording memory', { timeout: 10_000 }, async () => {
  const memory = new PersonalMemory(join(await mkdtemp(join(tmpdir(), 'intern-loop-')), 'state.json'));
  let completed = false;
  await runScenario(memory, async () => { throw new Error('Private memory destination required'); }, (step, input) => {
    if (step > 0) {
      const result = input.messages.filter(message => message.role === 'tool').at(-1);
      assert.match(String(result?.content), /Private memory destination required/);
      assert.doesNotMatch(String(result?.content), /Acme/);
    }
    if (step === 0) return { name: 'read_personal_memory', args: {} };
    if (step === 1) return { name: 'record_personal_memory', args: { observation: { kind: 'commitment', title: 'Send Acme proposal', deadline: { kind: 'unknown' }, evidence: [ref(0)] } } };
    assert.equal(step, 2);
    completed = true;
    return undefined;
  });
  assert.equal(completed, true);
  assert.equal((await memory.view(owner)).commitments.length, 0);
});
