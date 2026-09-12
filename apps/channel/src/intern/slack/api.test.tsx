import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SlackAccess } from './api';
const owner = { workspaceId: 'T1', userId: 'U1' };
const ref = { channelId: 'C1', threadTs: '1726000000.000001', workspaceHost: 'acme.slack.com' };
const fake = (replies: unknown[]) => {
  const calls: Array<{ method: string; args: Record<string, string>; token: string | null }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ method: String(input).split('/').at(-1)!, args: Object.fromEntries(new URLSearchParams(String(init?.body))), token: new Headers(init?.headers).get('Authorization') });
    const body = replies.shift();
    assert.notEqual(body, undefined, 'unexpected API call');
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { calls, fetcher };
};
const auth = { ok: true, team_id: 'T1', user_id: 'U1', url: 'https://acme.slack.com/' };
const info = { ok: true, channel: { id: 'C1', is_member: true, is_ext_shared: false } };
test('selected reads verify token owner and workspace, paginate, retain exact message sources', async () => {
  const f = fake([auth, info, { ok: true, messages: [{ user: 'U1', ts: ref.threadTs, text: 'I will send proposal Friday' }], has_more: true, response_metadata: { next_cursor: 'page2' } }, { ok: true, messages: [{ user: 'U2', ts: '1726000001.000002', text: 'Pricing approved' }], has_more: false }]);
  const result = await new SlackAccess('user-secret', undefined, f.fetcher).readThread(owner, ref);
  assert.equal(result.length, 2);
  assert.equal(result[1].authorId, 'U2');
  assert.equal(result[1].url, 'https://acme.slack.com/archives/C1/p1726000001000002');
  assert.equal(f.calls.at(-1)?.args.cursor, 'page2');
});
test('another owner, mismatched workspace host, non-membership and Slack failures deny source access', async () => {
  for (const replies of [[{ ...auth, user_id: 'U2' }], [{ ...auth, team_id: 'T2' }], [{ ...auth, url: 'https://other.slack.com' }], [auth, { ...info, channel: { id: 'C1', is_member: false } }], [auth, info, { ok: false, error: 'missing_scope' }]]) {
    const f = fake(replies);
    await assert.rejects(new SlackAccess('secret', undefined, f.fetcher).readThread(owner, ref));
  }
});
test('proactive delivery opens exactly the owner DM and refuses a mismatched bot workspace', async () => {
  const f = fake([{ ...auth, user_id: 'B1', bot_id: 'B1' }, { ok: true, channel: { id: 'D1' } }, { ok: true, channel: { id: 'D1', is_im: true, user: 'U1' } }, { ok: true, channel: 'D1', ts: '1726000002.000001' }]);
  const result = await new SlackAccess(undefined, 'bot-secret', f.fetcher).deliver(owner, 'Private briefing', 'job-id');
  assert.equal(result.channelId, 'D1');
  assert.equal(f.calls[1].args.users, 'U1');
  assert.equal(f.calls[3].args.channel, 'D1');
  const bad = fake([{ ...auth, team_id: 'T2', bot_id: 'B1' }]);
  await assert.rejects(new SlackAccess(undefined, 'bot-secret', bad.fetcher).deliver(owner, 'private', 'id'));
  assert.equal(bad.calls.length, 1);
});
test('empty or truncated thread reads fail visibly instead of claiming freshness', async () => {
  for (const page of [{ ok: true, messages: [] }, { ok: true, messages: [{ user: 'U1', ts: ref.threadTs, text: 'Hi' }], has_more: true }]) {
    await assert.rejects(new SlackAccess('secret', undefined, fake([auth, info, page]).fetcher).readThread(owner, ref));
  }
});
