import type { RunAgentInput } from '@ag-ui/core';
import { ChannelRunAgent } from '../../agent';

/** Keep the fresh-inner-run adapter, but never forward previous-turn evidence.
 * Each request reads its currently authorized work again. Current-turn tool
 * calls/results remain available for the Channels tool loop. */
export class PrivateRunAgent extends ChannelRunAgent {
  override run(input: RunAgentInput) {
    const start = input.messages.findLastIndex(message => message.role === 'user');
    return super.run({ ...input, messages: start < 0 ? [] : input.messages.slice(start), state: {} });
  }
}
