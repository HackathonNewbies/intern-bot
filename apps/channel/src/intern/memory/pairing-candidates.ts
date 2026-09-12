import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Discovery only: nothing in this directory grants access to memory. */
export async function savePairingCandidate(directory: string, candidate: { userId: string; conversationId: string }) {
  const key = createHash('sha256').update(JSON.stringify([candidate.userId, candidate.conversationId])).digest('hex');
  const path = join(directory, `${key}.json`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try { await writeFile(path, JSON.stringify(candidate, null, 2), { mode: 0o600, flag: 'wx' }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  return path;
}
