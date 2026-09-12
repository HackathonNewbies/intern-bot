import { z } from 'zod';

const id = z.string().trim().min(1).max(500);
export const OwnerSchema = z.object({ workspaceId: id, userId: id });
export type Owner = z.infer<typeof OwnerSchema>;
export const MessageSchema = z.object({
  threadId: id, messageId: id, authorId: id,
  sentAt: z.iso.datetime({ offset: true }), text: z.string().min(1).max(50000),
  url: z.url().refine(value => new URL(value).protocol === 'https:', 'Source URL must use https'),
});
export type SourceMessage = z.infer<typeof MessageSchema>;
const EvidenceRefSchema = z.object({ threadId: id, messageId: id, quote: z.string().min(1).max(50000) });
const refs = z.array(EvidenceRefSchema).min(1).max(10);
const timezone = z.string().refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Invalid timezone');
export const DeadlineSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('date'), date: z.iso.date(), timezone }),
  z.object({ kind: z.literal('instant'), at: z.iso.datetime({ offset: true }) }),
  z.object({ kind: z.literal('unknown') }),
]);
export const ObservationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('commitment'), title: id, deadline: DeadlineSchema, evidence: refs }),
  z.object({ kind: z.literal('blocker'), title: id, taskId: id, evidence: refs }),
  z.object({ kind: z.literal('resolve'), blockerId: id, evidence: refs }),
  z.object({ kind: z.literal('clarification'), question: id, evidence: refs }),
]);
export type Observation = z.infer<typeof ObservationSchema>;
export const EvidenceSchema = MessageSchema.extend({ quote: z.string() });
export const ItemSchema = z.object({
  id, kind: z.enum(['commitment', 'blocker', 'clarification']), title: z.string(),
  status: z.enum(['open', 'resolved']), evidence: z.array(EvidenceSchema),
  deadline: DeadlineSchema.optional(), taskId: id.optional(),
  resolutionEvidence: z.array(EvidenceSchema).optional(),
});
export type MemoryItem = z.infer<typeof ItemSchema>;
export const ChangeSchema = z.object({ id, itemId: id, kind: z.enum(['commitment', 'blocker', 'resolve', 'clarification']), acknowledged: z.boolean() });
export type MemoryChange = z.infer<typeof ChangeSchema>;
export type MemoryView = { commitments: MemoryItem[]; blockers: MemoryItem[]; questions: MemoryItem[]; changes: MemoryChange[] };
