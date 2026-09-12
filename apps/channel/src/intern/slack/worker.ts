import { ownerKey, type Owner } from './identity';
import { briefingText } from './cards';
import type { WorkService } from './work';

export function dueSlot(now: Date): string | undefined {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const field = (name: string) => parts.find(part => part.type === name)!.value;
  if (['Sat', 'Sun'].includes(field('weekday'))) return;
  const time = `${field('hour')}:${field('minute')}`;
  const slot = ['08:30', '09:00', '13:00', '17:00'].filter(slot => slot <= time).at(-1);
  return slot ? `${field('year')}-${field('month')}-${field('day')}:${slot}` : undefined;
}
export type DeliverBriefing = (owner: Owner, text: string, key: string) => Promise<unknown>;
/** Single-process worker; shares the owner's lock with on-demand work. */
export class BriefingWorker {
  private retryAt = new Map<string, number>();
  constructor(private work: WorkService, private deliver: DeliverBriefing, private now = () => new Date(), private report: (error: unknown) => void = () => undefined) {}
  async tick() {
    const key = dueSlot(this.now());
    if (!key || !this.work.access.canRead || !this.work.access.canDeliver) return;
    for (const listed of await this.work.profiles.list()) {
      try {
        await this.work.exclusive(listed.owner, async () => {
          const profile = await this.work.profiles.get(listed.owner);
          if (!profile.scheduled || profile.jobs.includes(key)) return;
          const retryKey = `${ownerKey(profile.owner)}:${key}`;
          if ((this.retryAt.get(retryKey) ?? 0) > this.now().getTime()) return;
          const snapshot = await this.work.refresh(profile.owner);
          const failed = snapshot.reads.some(read => read.status === 'unavailable') || Boolean(snapshot.ingestionError);
          if (failed) {
            this.retryAt.set(retryKey, this.now().getTime() + 120_000);
            if (!profile.jobs.includes(`${key}:warning`)) {
              await this.deliver(profile.owner, 'Your scheduled refresh could not read or process all selected threads. I will retry; no work has been marked complete. Send refresh to check again now.', `${key}:warning`);
              await this.work.profiles.finishJob(profile.owner, `${key}:warning`);
            }
            return;
          }
          this.retryAt.delete(retryKey);
          if (key.endsWith('08:30') || snapshot.memory.changes.length) {
            await this.deliver(profile.owner, briefingText(snapshot), key);
            // Acknowledgment means the transport confirmed delivery, never just a proposal or attempt.
            await this.work.memory.acknowledge(profile.owner, snapshot.memory.changes.map(change => change.id));
          }
          await this.work.profiles.finishJob(profile.owner, key);
        });
      } catch (error) { this.report(error); }
    }
  }
  start(intervalMs = 30_000) {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try { await this.tick(); } catch (error) { this.report(error); } finally { running = false; }
    };
    const timer = setInterval(() => { void tick(); }, intervalMs);
    timer.unref();
    void tick();
    return () => clearInterval(timer);
  }
}
