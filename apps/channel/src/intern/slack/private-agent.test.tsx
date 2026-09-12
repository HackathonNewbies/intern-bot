import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AbstractAgent } from '@ag-ui/client';
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/core';
import { from } from 'rxjs';
import { PrivateRunAgent } from './private-agent';
class ProbeAgent extends AbstractAgent {
  constructor(private inputs: RunAgentInput[]) { super(); }
  run(input: RunAgentInput) {
    this.inputs.push(input);
    return from<BaseEvent[]>([{ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId }, { type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId }]);
  }
}
test('successive SDK runs discard old source-bearing history while retaining the current tool loop', async () => {
  const inputs: RunAgentInput[] = [];
  const agent = new PrivateRunAgent(() => new ProbeAgent(inputs), 'private');
  agent.setMessages([{ id: 'old-request', role: 'user', content: 'read my thread' }]);
  await agent.runAgent();
  agent.addMessage({ id: 'old-reply', role: 'assistant', content: 'Secret acquisition from the old selected thread' });
  agent.addMessage({ id: 'new-request', role: 'user', content: 'What can I see after untracking?' });
  await agent.runAgent();
  assert.doesNotMatch(JSON.stringify(inputs.at(-1)), /Secret acquisition|old-request/);
  agent.addMessage({ id: 'new-tool-call', role: 'assistant', toolCalls: [{ id: 'read1', type: 'function', function: { name: 'read_personal_memory', arguments: '{}' } }] });
  agent.addMessage({ id: 'new-tool-result', role: 'tool', toolCallId: 'read1', content: 'Currently authorized evidence' });
  await agent.runAgent();
  assert.match(JSON.stringify(inputs.at(-1)), /Currently authorized evidence/);
  assert.doesNotMatch(JSON.stringify(inputs.at(-1)), /Secret acquisition/);
});
