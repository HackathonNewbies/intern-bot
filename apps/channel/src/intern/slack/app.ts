import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createChannel } from '@copilotkit/channels';
import { makeAgent } from 'agent-core';
import { z } from 'zod';
import { PrivateRunAgent } from './private-agent';
import { PersonalMemory } from '../memory/store';
import { PERSONAL_MEMORY_INSTRUCTIONS } from '../memory/tools';
import { SlackAccess } from './api';
import { InternController } from './controller';
import { identifyInternUser, VerifiedBindingSchema, type VerifiedBinding } from './identity';
import { makeIngestWork } from './ingest';
import { ProfileStore } from './profiles';
import { WorkService } from './work';
import { BriefingWorker } from './worker';

export function createInternApp(options: { name: string; dataDir?: string; userToken?: string; botToken?: string; bindings?: VerifiedBinding[] }) {
  const directory = resolve(options.dataDir ?? '.data/intern');
  const memory = new PersonalMemory(resolve(directory, 'memory.json'));
  const profiles = new ProfileStore(resolve(directory, 'profiles.json'));
  const access = new SlackAccess(options.userToken, options.botToken);
  const work = new WorkService(profiles, memory, access, makeIngestWork(memory));
  const controller = new InternController(work);
  const channel = createChannel({
    name: options.name,
    identifyUser: ctx => identifyInternUser(ctx, options.bindings),
    agent: threadId => new PrivateRunAgent(id => makeAgent(id, { workplace: false, prompt: PERSONAL_MEMORY_INSTRUCTIONS }), threadId),
    // Personal tools are attached per verified private run by the controller.
    tools: [],
  });
  channel.onMention(async ({ thread, message }) => { await controller.message(thread, message); });
  channel.onMessage(async ({ thread, message }) => { if (message.user) await controller.message(thread, message); });
  channel.onWelcome(async ({ thread, user, actor, platform }) => {
    if (!user || actor.kind !== 'human' || platform !== 'slack') return;
    await controller.message(thread, { text: 'start', user, actor, platform, ref: { id: 'welcome' }, operation: { kind: 'created', logicalMessageId: 'welcome', revisionId: 'welcome', mentioned: false } });
  });
  const worker = new BriefingWorker(work, (owner, text, key) => access.deliver(owner, text, key), undefined, () => {
    // Do not log private text or credential-bearing provider payloads.
    console.error('Intern background check failed. Check Slack connection permissions; it will retry.');
  });
  return { channel, controller, work, worker };
}
export function loadVerifiedBindings(path: string | undefined, channelCode: string): VerifiedBinding[] {
  if (!path) return [];
  const file = z.object({ channelCode: z.string(), bindings: z.array(VerifiedBindingSchema) }).parse(JSON.parse(readFileSync(path, 'utf8')));
  if (file.channelCode !== channelCode) throw new Error('Verified DM bindings belong to a different Channel.');
  const identities = file.bindings.map(binding => `${binding.userId}:${binding.conversationId}`);
  if (new Set(identities).size !== identities.length) throw new Error('Ambiguous verified DM bindings.');
  return file.bindings;
}
