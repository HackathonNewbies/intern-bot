import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { ChangeSchema, ItemSchema, MessageSchema, ObservationSchema, OwnerSchema,
  type MemoryItem, type MemoryView, type Observation, type Owner, type SourceMessage } from './model';

const StateSchema = z.object({ version: z.literal(1), people: z.array(z.object({
  key: z.string(), items: z.array(ItemSchema), changes: z.array(ChangeSchema),
  processed: z.array(z.object({ key: z.string(), itemId: z.string() })),
})) });
type State = z.infer<typeof StateSchema>;
// Serialize all instances using the same absolute file in this process.
// Multi-process/serverless deployments need a transactional database instead.
const queues = new Map<string, Promise<unknown>>();
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ownerKey = (owner: Owner) => JSON.stringify(Object.values(OwnerSchema.parse(owner)));

export class PersonalMemory {
  private readonly path: string;
  constructor(path: string) { this.path = resolve(path); }

  private async transaction<T>(change: (state: State) => T, write = true): Promise<T> {
    const previous = queues.get(this.path) ?? Promise.resolve();
    const job = previous.catch(() => undefined).then(async () => {
      let state: State;
      try { state = StateSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        state = { version: 1, people: [] };
      }
      const result = change(state);
      if (write) {
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        try {
          const file = await open(temporary, 'wx', 0o600);
          try { await file.writeFile(JSON.stringify(StateSchema.parse(state))); await file.sync(); }
          finally { await file.close(); }
          await rename(temporary, this.path);
        } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      }
      return result;
    });
    queues.set(this.path, job);
    try { return await job; }
    finally { if (queues.get(this.path) === job) queues.delete(this.path); }
  }

  async view(owner: Owner): Promise<MemoryView> {
    const key = ownerKey(owner);
    return this.transaction(state => {
      const person = state.people.find(person => person.key === key);
      const items = person?.items ?? [];
      return {
        commitments: items.filter(item => item.kind === 'commitment'),
        blockers: items.filter(item => item.kind === 'blocker'),
        questions: items.filter(item => item.kind === 'clarification'),
        changes: (person?.changes ?? []).filter(change => !change.acknowledged),
      };
    }, false);
  }

  /** Sources must come from the caller's authorized selected-thread transport, not model arguments. */
  async apply(ownerInput: Owner, input: Observation, sources: SourceMessage[]) {
    const owner = OwnerSchema.parse(ownerInput);
    const observation = ObservationSchema.parse(input);
    const messages = z.array(MessageSchema).parse(sources);
    const verifiedEvidence = observation.evidence.map(ref => {
      const matches = messages.filter(message => message.threadId === ref.threadId && message.messageId === ref.messageId);
      if (matches.length !== 1) throw new Error('Missing or ambiguous source evidence');
      const message = matches[0];
      if (!message.text.includes(ref.quote)) throw new Error('Evidence quote does not match source');
      return { ...message, quote: ref.quote };
    });
    // Validate every supplied ref, then retain each distinct source excerpt once.
    const evidence = [...new Map(verifiedEvidence.map(message => [
      JSON.stringify([message.threadId, message.messageId, message.quote]), message,
    ])).values()];
    if (observation.kind === 'commitment' && !evidence.some(message => message.authorId === owner.userId)) {
      throw new Error('Commitments require owner-authored evidence; ask for confirmation');
    }
    const key = ownerKey(owner);
    // Do not use model paraphrases as identity. One observation of each kind per
    // source set/target is supported in this first slice.
    const operationKey = digest([observation.kind,
      observation.kind === 'blocker' ? observation.taskId : observation.kind === 'resolve' ? observation.blockerId : '',
      [...new Map(evidence.map(message => {
        const sourceId = [message.threadId, message.messageId];
        return [JSON.stringify(sourceId), sourceId];
      })).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ]);
    return this.transaction(state => {
      let person = state.people.find(person => person.key === key);
      if (!person) { person = { key, items: [], changes: [], processed: [] }; state.people.push(person); }
      const processed = person.processed.find(record => record.key === operationKey);
      if (processed) return { item: person.items.find(item => item.id === processed.itemId)!, changed: false };
      let item: MemoryItem;
      if (observation.kind === 'resolve') {
        const blocker = person.items.find(item => item.id === observation.blockerId && item.kind === 'blocker');
        if (!blocker) throw new Error('Blocker not found');
        if (blocker.status === 'resolved') return { item: blocker, changed: false };
        const openedAt = Math.max(...blocker.evidence.map(message => Date.parse(message.sentAt)));
        if (!evidence.some(message => Date.parse(message.sentAt) > openedAt)) throw new Error('Resolution needs newer evidence');
        blocker.status = 'resolved';
        blocker.resolutionEvidence = evidence;
        item = blocker;
      } else {
        if (observation.kind === 'blocker') {
          const task = person.items.find(item => item.id === observation.taskId && item.kind === 'commitment');
          if (!task) throw new Error('Commitment not found');
          if (!evidence.some(source => task.evidence.some(original => original.threadId === source.threadId && original.messageId === source.messageId))) {
            throw new Error('Blocker needs commitment evidence as well as its dependency evidence');
          }
        }
        item = { id: randomUUID(), kind: observation.kind,
          title: observation.kind === 'clarification' ? observation.question : observation.title,
          status: 'open', evidence,
          ...(observation.kind === 'commitment' ? { deadline: observation.deadline } : {}),
          ...(observation.kind === 'blocker' ? { taskId: observation.taskId } : {}),
        };
        person.items.push(item);
      }
      person.processed.push({ key: operationKey, itemId: item.id });
      person.changes.push({ id: randomUUID(), itemId: item.id, kind: observation.kind, acknowledged: false });
      return { item, changed: true };
    });
  }

  /** Acknowledge only after the briefing worker durably accepts these notice IDs. */
  async acknowledge(owner: Owner, changeIds: string[]): Promise<void> {
    const key = ownerKey(owner);
    await this.transaction(state => {
      const person = state.people.find(person => person.key === key);
      for (const change of person?.changes ?? []) if (changeIds.includes(change.id)) change.acknowledged = true;
    });
  }
}
