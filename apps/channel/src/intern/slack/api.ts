import { createHash } from 'node:crypto';
import { z } from 'zod';
import { MessageSchema, type SourceMessage } from '../memory/model';
import { OwnerSchema, ThreadRefSchema, threadKey, type Owner, type ThreadRef } from './identity';

const AuthSchema = z.object({ team_id: z.string(), user_id: z.string(), bot_id: z.string().optional(), url: z.url() });
const InfoSchema = z.object({ channel: z.object({ id: z.string(), is_member: z.boolean().optional(), is_ext_shared: z.boolean().optional(), is_im: z.boolean().optional(), user: z.string().optional() }) });
const PageSchema = z.object({ messages: z.array(z.object({ user: z.string().optional(), ts: z.string(), text: z.string().optional(), bot_id: z.string().optional(), subtype: z.string().optional() })), has_more: z.boolean().optional(), response_metadata: z.object({ next_cursor: z.string().optional() }).optional() });

/** Optional, single-owner Slack API connection. Tokens never come from model arguments. */
export class SlackAccess {
  constructor(private userToken?: string, private botToken?: string, private fetcher: typeof fetch = fetch) {}
  get canRead() { return Boolean(this.userToken); }
  get canDeliver() { return Boolean(this.botToken); }
  private async call(token: string | undefined, method: string, args: Record<string, string> = {}) {
    if (!token) throw new Error(`Slack connection is not configured for ${method}.`);
    const response = await this.fetcher(`https://slack.com/api/${method}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(args), signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 429) throw new Error(`Slack rate limit; retry after ${response.headers.get('retry-after') ?? '60'} seconds.`);
    if (!response.ok) throw new Error(`Slack ${method} failed: HTTP ${response.status}.`);
    const result = z.object({ ok: z.boolean(), error: z.string().optional() }).passthrough().parse(await response.json());
    if (!result.ok) throw new Error(`Slack ${method}: ${result.error?.replace(/[^a-z0-9_]/gi, '').slice(0, 80) ?? 'request_failed'}.`);
    return result;
  }
  async readThread(ownerInput: Owner, refInput: ThreadRef): Promise<SourceMessage[]> {
    const owner = OwnerSchema.parse(ownerInput), ref = ThreadRefSchema.parse(refInput);
    // Revalidate every refresh so revoked/replaced credentials do not use a stale authorization cache.
    const auth = AuthSchema.parse(await this.call(this.userToken, 'auth.test'));
    if (auth.bot_id || auth.team_id !== owner.workspaceId || auth.user_id !== owner.userId || new URL(auth.url).hostname !== ref.workspaceHost) throw new Error('Slack read connection does not match this owner and workspace.');
    const info = InfoSchema.parse(await this.call(this.userToken, 'conversations.info', { channel: ref.channelId }));
    if (info.channel.id !== ref.channelId || info.channel.is_member !== true || info.channel.is_ext_shared === true) throw new Error('Select a thread in a workspace channel you belong to. Slack Connect is not supported.');
    const messages: SourceMessage[] = [], cursors = new Set<string>();
    let cursor = '';
    for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
      const page = PageSchema.parse(await this.call(this.userToken, 'conversations.replies', { channel: ref.channelId, ts: ref.threadTs, limit: '100', ...(cursor ? { cursor } : {}) }));
      for (const message of page.messages) {
        if (!message.user || message.bot_id || message.subtype || !message.text) continue;
        if (!/^\d{10,}\.\d{6}$/.test(message.ts)) throw new Error('Slack returned an invalid source timestamp.');
        messages.push(MessageSchema.parse({ threadId: threadKey(ref), messageId: message.ts, authorId: message.user, text: message.text, sentAt: new Date(Number(message.ts) * 1000).toISOString(), url: `https://${ref.workspaceHost}/archives/${ref.channelId}/p${message.ts.replace('.', '')}` }));
      }
      cursor = page.response_metadata?.next_cursor ?? '';
      if (!page.has_more && !cursor) {
        if (!messages.length) throw new Error('No readable messages found; freshness is unknown.');
        return [...new Map(messages.map(message => [message.messageId, message])).values()];
      }
      if (!cursor || cursors.has(cursor)) throw new Error('Slack returned incomplete thread history. Retry the read.');
      cursors.add(cursor);
    }
    throw new Error('Thread exceeds the read limit; choose a smaller thread.');
  }
  async verifyDelivery(owner: Owner) {
    const auth = AuthSchema.parse(await this.call(this.botToken, 'auth.test'));
    if (!auth.bot_id || auth.team_id !== OwnerSchema.parse(owner).workspaceId) throw new Error('Slack bot connection does not match this workspace.');
  }
  async deliver(owner: Owner, text: string, deliveryKey: string) {
    await this.verifyDelivery(owner);
    const opened = z.object({ channel: z.object({ id: z.string().regex(/^D[A-Z0-9]+$/) }) }).parse(await this.call(this.botToken, 'conversations.open', { users: owner.userId }));
    const info = InfoSchema.parse(await this.call(this.botToken, 'conversations.info', { channel: opened.channel.id }));
    if (info.channel.id !== opened.channel.id || info.channel.is_im !== true || info.channel.user !== owner.userId) throw new Error('Slack did not verify the owner’s one-to-one DM.');
    const hex = createHash('sha256').update(JSON.stringify([owner, deliveryKey])).digest('hex');
    const clientMessageId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const posted = z.object({ channel: z.string(), ts: z.string() }).parse(await this.call(this.botToken, 'chat.postMessage', { channel: opened.channel.id, text, unfurl_links: 'false', unfurl_media: 'false', client_msg_id: clientMessageId }));
    if (posted.channel !== opened.channel.id) throw new Error('Slack delivery returned an unexpected destination.');
    return { channelId: posted.channel, messageId: posted.ts };
  }
}
