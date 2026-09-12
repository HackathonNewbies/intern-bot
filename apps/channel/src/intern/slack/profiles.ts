import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { OwnerSchema, ThreadRefSchema, ownerKey, threadKey, type Owner, type ThreadRef } from './identity';

const ProfileSchema = z.object({ owner: OwnerSchema, role: z.string().trim().max(160), goals: z.array(z.string().trim().min(1).max(200)).max(3), threads: z.array(ThreadRefSchema).max(10), scheduled: z.boolean(), jobs: z.array(z.string()).max(100) });
export type Profile = z.infer<typeof ProfileSchema>;
const StateSchema = z.object({ version: z.literal(1), people: z.array(ProfileSchema) });
const queues = new Map<string, Promise<unknown>>();
export class ProfileStore {
  private path: string;
  constructor(path: string) { this.path = resolve(path); }
  private async transaction<T>(fn: (state: z.infer<typeof StateSchema>) => T, write = true): Promise<T> {
    const job = (queues.get(this.path) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      let state: z.infer<typeof StateSchema>;
      try { state = StateSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; state = { version: 1, people: [] }; }
      const result = fn(state);
      if (write) {
        const data = JSON.stringify(StateSchema.parse(state));
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        try {
          const file = await open(temporary, 'wx', 0o600);
          try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
          await rename(temporary, this.path);
        } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      }
      return structuredClone(result);
    });
    queues.set(this.path, job);
    try { return await job; } finally { if (queues.get(this.path) === job) queues.delete(this.path); }
  }
  private empty(owner: Owner): Profile { return { owner: OwnerSchema.parse(owner), role: '', goals: [], threads: [], scheduled: false, jobs: [] }; }
  async get(owner: Owner) { return this.transaction(state => state.people.find(p => ownerKey(p.owner) === ownerKey(owner)) ?? this.empty(owner), false); }
  async list() { return this.transaction(state => state.people, false); }
  private async change(owner: Owner, fn: (profile: Profile) => void) {
    return this.transaction(state => {
      let profile = state.people.find(p => ownerKey(p.owner) === ownerKey(owner));
      if (!profile) { profile = this.empty(owner); state.people.push(profile); }
      fn(profile); return ProfileSchema.parse(profile);
    });
  }
  async configure(owner: Owner, role: string, goals: string[]) {
    if (!role.trim()) throw new Error('Enter your role.');
    return this.change(owner, p => { p.role = role.trim(); p.goals = goals; });
  }
  async select(owner: Owner, ref: ThreadRef) { return this.change(owner, p => { if (!p.threads.some(r => threadKey(r) === threadKey(ref))) p.threads.push(ThreadRefSchema.parse(ref)); }); }
  async remove(owner: Owner, ref: ThreadRef) { return this.change(owner, p => { p.threads = p.threads.filter(r => threadKey(r) !== threadKey(ref)); }); }
  async setSchedule(owner: Owner, enabled: boolean) { return this.change(owner, p => { p.scheduled = enabled; }); }
  async finishJob(owner: Owner, key: string) { return this.change(owner, p => { p.jobs = [...new Set([...p.jobs, key])].slice(-100); }); }
}
