import type { MemoryView, SourceMessage } from '../memory/model';
import type { PersonalMemory } from '../memory/store';
import { ownerKey, threadKey, type Owner, type ThreadRef } from './identity';
import type { Profile, ProfileStore } from './profiles';
import { visibleMemory } from './ingest';

export type ThreadRead = { ref: ThreadRef; status: 'fresh' | 'unavailable'; checkedAt: string; error?: string };
export type WorkSnapshot = { profile: Profile; memory: MemoryView; sources: SourceMessage[]; reads: ThreadRead[]; hiddenItems: number; generatedAt: string; ingestionError?: string; fixture?: boolean };
export interface WorkAccess { readonly canRead: boolean; readonly canDeliver: boolean; readThread(owner: Owner, ref: ThreadRef): Promise<SourceMessage[]>; }
export type IngestWork = (owner: Owner, sources: SourceMessage[]) => Promise<void>;

/** Shared ports for Task B extraction and Task C content/scheduling. */
export class WorkService {
  private queues = new Map<string, Promise<unknown>>();
  constructor(readonly profiles: ProfileStore, readonly memory: PersonalMemory, readonly access: WorkAccess, private ingest: IngestWork, private now = () => new Date()) {}
  async exclusive<T>(owner: Owner, run: () => Promise<T>): Promise<T> {
    const key = ownerKey(owner);
    const job = (this.queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(run);
    this.queues.set(key, job);
    try { return await job; } finally { if (this.queues.get(key) === job) this.queues.delete(key); }
  }
  async select(owner: Owner, ref: ThreadRef) {
    await this.access.readThread(owner, ref); // Authorization before persisting a selection.
    return this.profiles.select(owner, ref);
  }
  async refresh(owner: Owner, ingest = true): Promise<WorkSnapshot> {
    const profile = await this.profiles.get(owner);
    const sources: SourceMessage[] = [], reads: ThreadRead[] = [];
    // Sequential reads respect Slack's per-method throttling and provide individual failures.
    for (const ref of profile.threads) {
      try {
        const messages = await this.access.readThread(owner, ref);
        if (!messages.length || messages.some(message => message.threadId !== threadKey(ref))) throw new Error('Source reader returned incomplete or mismatched history.');
        sources.push(...messages);
        reads.push({ ref, status: 'fresh', checkedAt: this.now().toISOString() });
      } catch (error) {
        reads.push({ ref, status: 'unavailable', checkedAt: this.now().toISOString(), error: error instanceof Error ? error.message : 'Thread read failed.' });
      }
    }
    let ingestionError: string | undefined;
    if (ingest && sources.length) {
      try { await this.ingest(owner, sources); } catch { ingestionError = 'Work extraction did not finish. Saved work may be incomplete; retry refresh.'; }
    }
    const view = await this.memory.view(owner);
    const memory = visibleMemory(view, sources);
    const visibleCount = memory.commitments.length + memory.blockers.length + memory.questions.length;
    return { profile, sources, reads, generatedAt: this.now().toISOString(), ingestionError, hiddenItems: view.commitments.length + view.blockers.length + view.questions.length - visibleCount,
      memory };
  }
}
