import type { ChannelIdentityContext } from '@copilotkit/channels';
import { z } from 'zod';

const identity = z.object({ workspaceId: z.string().min(1), userId: z.string().min(1), channelId: z.string().regex(/^D[A-Z0-9]+$/) });
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
export const TestPairingSchema = identity.extend({
  channelCode: z.literal('intern-memory-test'), workspaceId: z.string().regex(/^T[A-Z0-9]+$/),
  userId: z.string().regex(/^U[A-Z0-9]+$/), conversationId: z.string().min(1),
});

/** Only ingress-provided facts are used; message text never authorizes a DM. */
export function identifyMemoryTestUser(ctx: ChannelIdentityContext, pairing?: unknown) {
  if (ctx.provider !== 'slack' || ctx.actor.kind !== 'human' || !ctx.actor.id) return null;
  const raw = object(ctx.raw);
  const event = object(raw.event ?? raw);
  if (pairing !== undefined) {
    const result = TestPairingSchema.safeParse(pairing);
    if (!result.success) return null;
    const pin = result.data;
    if (ctx.actor.id !== pin.userId || ctx.conversation.id !== pin.conversationId
      || (ctx.tenant.id !== 'unknown' && ctx.tenant.id !== pin.workspaceId)
      || (event.channel !== undefined && event.channel !== pin.channelId)
      || (event.channel_type !== undefined && event.channel_type !== 'im')) return null;
    return { id: JSON.stringify(identity.parse(pin)), name: ctx.actor.name ?? ctx.actor.id };
  }
  if (ctx.tenant.id === 'unknown') return null;
  const channelId = typeof event.channel === 'string' ? event.channel : ctx.conversation.id.split('::')[0];
  const parsed = identity.safeParse({ workspaceId: ctx.tenant.id, userId: ctx.actor.id, channelId });
  if (!parsed.success || (event.channel_type !== undefined && event.channel_type !== 'im')) return null;
  return { id: JSON.stringify(parsed.data), name: ctx.actor.name ?? ctx.actor.id };
}

export function parseMemoryTestUser(userId: string) { return identity.parse(JSON.parse(userId)); }
