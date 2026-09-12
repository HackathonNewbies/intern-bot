import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToIR, type ChannelMessage, type Thread } from '@copilotkit/channels';
import { ProfileStore } from './profiles';
import { PersonalMemory } from '../memory/store';
import { WorkService } from './work';
import { InternController } from './controller';
const owner = { workspaceId: 'T1', userId: 'U1', channelId: 'D1' };
const message = (text: string, privateUser = true) => ({ text, user: privateUser ? { id: JSON.stringify(owner), name: 'Alex' } : null, actor: { id: 'U1', kind: 'human' }, ref: { id: 'message1' }, platform: 'slack', operation: { kind: 'created', logicalMessageId: 'message1', revisionId: 'message1', mentioned: true } }) as ChannelMessage;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'intern-controller-'));
  const service = new WorkService(new ProfileStore(join(root, 'p.json')), new PersonalMemory(join(root, 'm.json')), { canRead: false, canDeliver: false, async readThread() { throw new Error('No Slack connection'); } }, async () => undefined);
  const sent: string[] = [], runs: unknown[] = [];
  const thread = { platform: 'slack', async post(ui: unknown) { sent.push(JSON.stringify(renderToIR(ui as never))); return { id: 'posted' }; }, async postEphemeral(_user: unknown, ui: unknown) { sent.push(`private:${JSON.stringify(renderToIR(ui as never))}`); return { ok: true }; }, async runAgent(input: unknown) { runs.push(input); }, async getMessages() { return []; } } as unknown as Thread;
  return { controller: new InternController(service), service, thread, sent, runs };
}
test('public mention produces only a private redirect, never personal tools or agent output', async () => {
  const f = await fixture();
  await f.controller.message(f.thread, message('brief', false));
  assert.equal(f.runs.length, 0);
  assert.equal(f.sent.length, 1);
  assert.ok(f.sent[0].startsWith('private:'));
  assert.match(f.sent[0], /one-to-one DM/);
});
test('private onboarding persists profile and fixture briefing does not mutate memory', async () => {
  const f = await fixture();
  await f.controller.message(f.thread, message('profile Designer | Ship proposal; Improve onboarding'));
  assert.deepEqual((await f.service.profiles.get(owner)).goals, ['Ship proposal', 'Improve onboarding']);
  await f.controller.message(f.thread, message('demo'));
  assert.match(f.sent.at(-1)!, /fictional|Fictional/);
  assert.match(f.sent.at(-1)!, /pricing/i);
  assert.equal((await f.service.memory.view(owner)).commitments.length, 0);
});
test('old card actions from another actor cannot access or modify the profile', async () => {
  const f = await fixture();
  await assert.rejects(f.controller.action(owner, 'schedule-on', { thread: f.thread, user: { id: JSON.stringify({ ...owner, userId: 'U2' }), name: 'Other' }, actor: { id: 'U2', kind: 'human' }, platform: 'slack', message: message(''), action: { id: 'action1' }, values: {} }));
  assert.equal((await f.service.profiles.get(owner)).scheduled, false);
  assert.equal(f.sent.length, 0);
});
test('unconfigured schedule remains disabled and a failed selected read is not persisted', async () => {
  const f = await fixture();
  await f.controller.message(f.thread, message('schedule on'));
  assert.equal((await f.service.profiles.get(owner)).scheduled, false);
  await f.controller.message(f.thread, message('track https://acme.slack.com/archives/C1/p1726000000000001'));
  assert.equal((await f.service.profiles.get(owner)).threads.length, 0);
  assert.match(f.sent.at(-1)!, /connection/i);
});
test('integrated private tools route completion and undo with current owner evidence and preserve calendar', async () => {
  const f = await fixture();
  const ref = { channelId: 'C1', threadTs: '1726000000.000001', workspaceHost: 'acme.slack.com' };
  const source = { threadId: 'C1:1726000000.000001', messageId: '1726000000.000001', authorId: 'U1', text: 'I will send the proposal', sentAt: '2024-09-10T20:26:40Z', url: 'https://acme.slack.com/archives/C1/p1726000000000001' };
  f.service.access.readThread = async () => [source];
  await f.service.profiles.select(owner, ref);
  const created = await f.service.memory.apply(owner, { kind: 'commitment', title: 'Send the proposal', deadline: { kind: 'unknown' }, evidence: [{ threadId: source.threadId, messageId: source.messageId, quote: source.text }] }, [source]);
  const request = message('I sent the proposal; mark Send the proposal done.');
  await f.controller.message(f.thread, request);
  type Tool = { name: string; handler(args: unknown, ctx: unknown): Promise<unknown> };
  const tools = (f.runs.at(-1) as { tools: Tool[] }).tools;
  assert.ok(tools.some(tool => tool.name === 'propose_calendar_invite'));
  assert.ok(tools.some(tool => tool.name === 'propose_available_calendar_invite'));
  const context = (f.runs.at(-1) as { context: { value: string }[] }).context.map(entry => entry.value).join('\n');
  assert.doesNotMatch(context, /no calendar.*tools/i, 'The integrated model must not be told its registered calendar tool is unavailable');
  assert.match(context, /propose_available_calendar_invite/);
  assert.match(context, /30-minute meeting/);
  const ctx = { thread: f.thread, message: request, user: request.user, actor: request.actor, platform: 'slack' };
  await assert.rejects(tools.find(tool => tool.name === 'propose_available_calendar_invite')!.handler({}, { ...ctx, actor: { id: 'U2', kind: 'human' } }), /actor does not match/);
  await tools.find(tool => tool.name === 'record_personal_memory')!.handler({ observation: { kind: 'complete', taskId: created.item.id, evidence: [{ threadId: 'dm:D1', messageId: 'message1', quote: request.text }] } }, ctx);
  assert.equal((await f.service.memory.view(owner)).commitments[0].status, 'completed');
  const undo = message('Undo that completion.');
  undo.operation.logicalMessageId = 'message2';
  await f.controller.message(f.thread, undo);
  const next = (f.runs.at(-1) as { tools: Tool[] }).tools;
  const changeId = (await f.service.memory.view(owner)).mutations![0].changeId;
  await next.find(tool => tool.name === 'record_personal_memory')!.handler({ observation: { kind: 'undo', changeId, evidence: [{ threadId: 'dm:D1', messageId: 'message2', quote: undo.text }] } }, { ...ctx, message: undo });
  assert.equal((await f.service.memory.view(owner)).commitments[0].status, 'open');
});
