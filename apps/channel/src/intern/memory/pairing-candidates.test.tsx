import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { savePairingCandidate } from './pairing-candidates';

test('different users can request pairing concurrently and retries preserve their candidates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'memory-pairings-'));
  try {
    const first = { userId: 'U123', conversationId: 'opaque/one' };
    const second = { userId: 'U456', conversationId: 'opaque/two' };
    const paths = await Promise.all([first, second, first].map(candidate => savePairingCandidate(directory, candidate)));
    assert.equal(paths[0], paths[2]);
    assert.notEqual(paths[0], paths[1]);
    assert.equal((await readdir(directory)).length, 2);
    assert.deepEqual(JSON.parse(await readFile(paths[0], 'utf8')), first);
    assert.deepEqual(JSON.parse(await readFile(paths[1], 'utf8')), second);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
