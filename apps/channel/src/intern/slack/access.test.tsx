import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChannelIdentityContext } from '@copilotkit/channels';
import { identifyInternUser, parseIdentity, parseThreadLink } from './identity';
import { ProfileStore } from './profiles';

const context = (extra: Record<string, unknown> = {}) => ({ provider: 'slack', tenant: { id: 'T1' }, installation: { id: 'I1' }, actor: { id: 'U1', kind: 'human' }, conversation: { id: 'D1::123.000001', kind: 'im' }, trigger: 'message', event: {}, raw: { event: { channel: 'D1', channel_type: 'im' } }, ...extra }) as ChannelIdentityContext;
test('private identity rejects unknown workspace, shared/group conversations, and non-human events', () => {
  assert.deepEqual(parseIdentity(identifyInternUser(context())!.id), { workspaceId: 'T1', userId: 'U1', channelId: 'D1' });
  for (const ctx of [context({ tenant: { id: 'unknown' } }), context({ raw: { event: { channel: 'C1', channel_type: 'channel' } } }), context({ raw: { event: { channel: 'D1', channel_type: 'mpim' } } }), context({ actor: { id: 'B1', kind: 'bot' } }), context({ conversation: { id: 'opaque' }, raw: {} })]) assert.equal(identifyInternUser(ctx), null);
});
test('Slack thread URLs normalize reply links to their parent and reject other origins', () => {
  assert.deepEqual(parseThreadLink('https://acme.slack.com/archives/C1/p1726000000000001?thread_ts=1725999999.000002&cid=C1'), { channelId: 'C1', threadTs: '1725999999.000002', workspaceHost: 'acme.slack.com' });
  for (const url of ['https://evil.test/archives/C1/p1726000000000001', 'https://slack.com.evil.test/archives/C1/p1726000000000001', 'http://acme.slack.com/archives/C1/p1726000000000001', 'https://acme.slack.com/archives/C1/pbad']) assert.throws(() => parseThreadLink(url));
});
test('profiles persist independently, serialize concurrent updates, and bound goals and selections', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'intern-profile-')), 'profiles.json');
  const store = new ProfileStore(path);
  const a = { workspaceId: 'T1', userId: 'U1' }, b = { workspaceId: 'T1', userId: 'U2' };
  await store.configure(a, 'Designer', ['Ship proposal']);
  await assert.rejects(store.configure(a, 'Designer', ['1', '2', '3', '4']));
  const ref = parseThreadLink('https://acme.slack.com/archives/C1/p1726000000000001');
  await Promise.all([store.select(a, ref), store.setSchedule(a, true)]);
  assert.equal((await new ProfileStore(path).get(a)).threads.length, 1);
  assert.equal((await store.get(a)).scheduled, true);
  assert.equal((await store.get(b)).threads.length, 0);
  await store.select(a, ref);
  assert.equal((await store.get(a)).threads.length, 1);
  await store.remove(a, ref);
  assert.equal((await store.get(a)).threads.length, 0);
  assert.match(await readFile(path, 'utf8'), /Designer/);
});
test('operator-verified managed binding only authorizes its exact actor and conversation', () => {
  const binding = { workspaceId: 'T1', userId: 'U1', channelId: 'D1', conversationId: 'opaque-dm' };
  const opaque = context({ tenant: { id: 'unknown' }, conversation: { id: 'opaque-dm' }, raw: {} });
  assert.equal(identifyInternUser(opaque), null);
  assert.equal(parseIdentity(identifyInternUser(opaque, [binding])!.id).channelId, 'D1');
  assert.equal(identifyInternUser({ ...opaque, conversation: { id: 'other' } }, [binding]), null);
  assert.equal(identifyInternUser({ ...opaque, actor: { id: 'U2', kind: 'human' } }, [binding]), null);
  assert.equal(identifyInternUser({ ...opaque, tenant: { id: 'T2' } }, [binding]), null);
});
