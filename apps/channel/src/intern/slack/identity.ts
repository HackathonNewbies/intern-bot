import type { ChannelIdentityContext } from '@copilotkit/channels';
import { z } from 'zod';

export const OwnerSchema = z.object({ workspaceId: z.string().regex(/^T[A-Z0-9]+$/), userId: z.string().regex(/^[UW][A-Z0-9]+$/) });
export type Owner = z.infer<typeof OwnerSchema>;
const IdentitySchema = OwnerSchema.extend({ channelId: z.string().regex(/^D[A-Z0-9]+$/) });
export const ThreadRefSchema = z.object({ channelId: z.string().regex(/^[CG][A-Z0-9]+$/), threadTs: z.string().regex(/^\d{10,}\.\d{6}$/), workspaceHost: z.string().regex(/^[a-z0-9-]+\.slack\.com$/) });
export type ThreadRef = z.infer<typeof ThreadRefSchema>;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};

/** Ingress facts only. Unknown managed metadata never grants private access. */
export const VerifiedBindingSchema = IdentitySchema.extend({ conversationId: z.string().min(1) });
export type VerifiedBinding = z.infer<typeof VerifiedBindingSchema>;
export function identifyInternUser(ctx: ChannelIdentityContext, bindings: VerifiedBinding[] = []) {
  if (ctx.provider !== 'slack' || ctx.actor.kind !== 'human') return null;
  const raw = object(ctx.raw), event = object(raw.event ?? raw);
  const binding = bindings.find(binding => binding.userId === ctx.actor.id && binding.conversationId === ctx.conversation.id);
  if (binding) {
    if ((ctx.tenant.id !== 'unknown' && ctx.tenant.id !== binding.workspaceId) || (event.channel !== undefined && event.channel !== binding.channelId) || (event.channel_type !== undefined && event.channel_type !== 'im') || ['channel', 'group', 'mpim'].includes(ctx.conversation.kind ?? '')) return null;
    return { id: JSON.stringify(IdentitySchema.parse(binding)), name: ctx.actor.name ?? ctx.actor.id };
  }
  const channelId = event.channel ?? ctx.conversation.id.split('::')[0];
  if ((event.channel_type !== undefined && event.channel_type !== 'im') || (ctx.conversation.kind !== undefined && !['im', 'dm', 'direct'].includes(ctx.conversation.kind))) return null;
  const parsed = IdentitySchema.safeParse({ workspaceId: ctx.tenant.id, userId: ctx.actor.id, channelId });
  return parsed.success ? { id: JSON.stringify(parsed.data), name: ctx.actor.name ?? ctx.actor.id } : null;
}
export const parseIdentity = (id: string) => IdentitySchema.parse(JSON.parse(id));
export const ownerKey = (owner: Owner) => JSON.stringify(OwnerSchema.parse(owner));
export const threadKey = (ref: ThreadRef) => `${ref.channelId}:${ref.threadTs}`;
export function parseThreadLink(input: string): ThreadRef {
  const url = new URL(input.trim().replace(/^<([^|>]+)(?:\|[^>]+)?>$/, '$1'));
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Use a Slack HTTPS thread link.');
  const match = /^\/archives\/([CG][A-Z0-9]+)\/p(\d{10,})(\d{6})$/.exec(url.pathname);
  if (!match) throw new Error('Copy a Slack channel thread link.');
  return ThreadRefSchema.parse({ channelId: match[1], threadTs: url.searchParams.get('thread_ts') ?? `${match[2]}.${match[3]}`, workspaceHost: url.hostname });
}
export const threadUrl = (ref: ThreadRef) => `https://${ref.workspaceHost}/archives/${ref.channelId}/p${ref.threadTs.replace('.', '')}`;
