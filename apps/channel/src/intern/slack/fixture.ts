import type { WorkSnapshot } from './work';
import type { Owner } from './identity';
export function exampleSnapshot(owner: Owner): WorkSnapshot {
  const first = { threadId: 'CDEMO:1726000000.000001', messageId: '1726000000.000001', authorId: 'ALEX', sentAt: '2024-09-10T20:26:40Z', text: 'I will send the Acme proposal Friday.', quote: 'I will send the Acme proposal Friday.', url: 'https://example.slack.com/archives/CDEMO/p1726000000000001' };
  const second = { ...first, threadId: 'CPRICING:1726000001.000001', messageId: '1726000001.000001', authorId: 'PRIYA', text: 'The Acme proposal is waiting for pricing approval.', quote: 'The Acme proposal is waiting for pricing approval.', url: 'https://example.slack.com/archives/CPRICING/p1726000001000001' };
  return { fixture: true, generatedAt: '2024-09-11T00:30:00Z', profile: { owner, role: 'Example: account lead', goals: ['Send the Acme proposal'], threads: [], scheduled: false, jobs: [] }, sources: [first, second], reads: [], hiddenItems: 0,
    memory: { commitments: [{ id: 'demo-task', kind: 'commitment', title: 'Send the Acme proposal', status: 'open', deadline: { kind: 'date', date: '2024-09-13', timezone: 'Asia/Singapore' }, evidence: [first] }], blockers: [{ id: 'demo-blocker', kind: 'blocker', taskId: 'demo-task', title: 'Acme pricing needs approval', status: 'open', evidence: [first, second] }], questions: [], changes: [] } };
}
