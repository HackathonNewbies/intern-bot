import { randomUUID } from 'node:crypto';
import { BuiltInAgent } from '@copilotkit/runtime/v2';
import { resolveModel } from 'agent-core';
import { z } from 'zod';
import { ObservationSchema, type MemoryView, type MemoryItem, type Owner, type SourceMessage } from '../memory/model';
import { PERSONAL_MEMORY_INSTRUCTIONS } from '../memory/tools';
import type { PersonalMemory } from '../memory/store';

export function visibleMemory(view: MemoryView, sources: SourceMessage[]): MemoryView {
  const sourceMap = new Map(sources.map(s => [JSON.stringify([s.threadId, s.messageId]), s]));
  const visible = (item: MemoryItem) => item.evidence.length > 0 && [...item.evidence, ...(item.resolutionEvidence ?? [])].every(e => {
    const source = sourceMap.get(JSON.stringify([e.threadId, e.messageId]));
    return source?.text === e.text && source.authorId === e.authorId;
  });
  const commitments = view.commitments.filter(visible), taskIds = new Set(commitments.map(item => item.id));
  const blockers = view.blockers.filter(item => visible(item) && (!item.taskId || taskIds.has(item.taskId)));
  const questions = view.questions.filter(visible);
  const ids = new Set([...commitments, ...blockers, ...questions].map(item => item.id));
  return { commitments, blockers, questions, changes: view.changes.filter(change => ids.has(change.itemId)), mutations: view.mutations?.filter(change => ids.has(change.itemId)) };
}
export async function authorizeMutationResult(memory: PersonalMemory, owner: Owner, sources: SourceMessage[], result: { item: MemoryItem; changed: boolean }) {
  const view = visibleMemory(await memory.view(owner), sources);
  if (![...view.commitments, ...view.blockers, ...view.questions].some(item => item.id === result.item.id)) return { changed: result.changed, needsReview: 'A changed source requires reconciliation before its saved work can be shown.' };
  return result;
}
export function createIngestionTools(memory: PersonalMemory, owner: Owner, sources: SourceMessage[]) {
  let complete = false;
  const read = { name: 'read_personal_memory', description: 'Read current authorized work and selected-thread evidence before every update.', parameters: z.object({}), async execute(_args: unknown) { return { memory: visibleMemory(await memory.view(owner), sources), sources }; } };
  const record = { name: 'record_personal_memory', description: 'Record one evidence-backed observation. Reuse existing task and blocker IDs. Only use the selected sources.', parameters: z.object({ observation: ObservationSchema }), async execute(args: unknown) {
    const { observation } = z.object({ observation: ObservationSchema }).parse(args);
    if (['complete', 'correct', 'undo'].includes(observation.kind)) throw new Error('Background refresh cannot complete, correct or undo personal work.');
    const target = 'taskId' in observation ? observation.taskId : 'blockerId' in observation ? observation.blockerId : undefined;
    const view = visibleMemory(await memory.view(owner), sources);
    if (target && ![...view.commitments, ...view.blockers].some(item => item.id === target)) throw new Error('Observation target is not currently authorized.');
    return authorizeMutationResult(memory, owner, sources, await memory.apply(owner, observation, sources));
  } };
  const finish = { name: 'finish_refresh', description: 'Call after reviewing all evidence and recording all supported updates or clarifications. Never call if a tool failed and the failure remains unresolved.', parameters: z.object({}), async execute(_args: unknown) { complete = true; return 'Refresh review finished.'; } };
  return { read, record, finish, finished: () => complete };
}
export function makeIngestWork(memory: PersonalMemory) {
  return async (owner: Owner, sources: SourceMessage[]) => {
    if (JSON.stringify(sources).length > 100_000) throw new Error('Selected evidence exceeds the extraction limit. Select fewer or smaller threads.');
    const tools = createIngestionTools(memory, owner, sources);
    const agent = new BuiltInAgent({ model: resolveModel(), maxSteps: 15, prompt: `${PERSONAL_MEMORY_INSTRUCTIONS}\nYou are refreshing selected-thread work in the background. Read, then record each necessary observation. Do not repeat existing work. A dependency resolution never completes the commitment. Use clarification for uncertainty. Call finish_refresh when done. You have no delivery or calendar tools.`, tools: [tools.read, tools.record, tools.finish] });
    agent.threadId = `intern-refresh-${randomUUID()}`;
    agent.setMessages([{ id: randomUUID(), role: 'user', content: 'Review the authorized sources and refresh the work memory. Read existing state first.' }]);
    const timer = setTimeout(() => agent.abortRun(), 120_000);
    try { await agent.runAgent(); if (!tools.finished()) throw new Error('Extraction did not finish.'); }
    finally { clearTimeout(timer); }
  };
}
