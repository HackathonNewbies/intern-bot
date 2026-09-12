import type { SourceMessage } from './model';

/** Fictional, labeled inputs for a FUTURE model interpretation evaluation.
 * These are not executed by the deterministic persistence tests and do not
 * establish model accuracy. A harness must supply existing memory, run the
 * actual interpreter and judge resulting observations against these labels.
 */
type SemanticEvidenceFixture = {
  id: string;
  ownerId: string;
  existingWork: string[];
  sources: SourceMessage[];
  expected: { disposition: 'clarification'; mustNot: string[]; reason: string };
};
const message = (threadId: string, messageId: string, authorId: string, text: string): SourceMessage => ({
  threadId, messageId, authorId, text, sentAt: '2026-09-14T10:00:00+08:00',
  url: `https://example.invalid/${threadId}/${messageId}`,
});

export const semanticEvidenceFixtures: SemanticEvidenceFixture[] = [
  {
    id: 'other-person-promise-owner-thanks', ownerId: 'alex', existingWork: [],
    sources: [message('sales', '1', 'jo', "I'll send the Acme proposal."), message('sales', '2', 'alex', 'Thanks!')],
    expected: { disposition: 'clarification', mustNot: ['Create an Acme commitment owned by Alex'], reason: 'Courtesy is not acceptance of another person’s promise.' },
  },
  {
    id: 'owner-quotes-colleague', ownerId: 'alex', existingWork: [],
    sources: [message('sales', '1', 'alex', 'Jo wrote: "I will send the Acme proposal."')],
    expected: { disposition: 'clarification', mustNot: ['Create an Acme commitment owned by Alex'], reason: 'Message authorship does not imply ownership of quoted intent.' },
  },
  {
    id: 'tentative-intent', ownerId: 'alex', existingWork: [],
    sources: [message('sales', '1', 'alex', 'I might send the Acme proposal Friday if I have time.')],
    expected: { disposition: 'clarification', mustNot: ['Create a firm Friday commitment'], reason: 'Tentative intent is not an explicit commitment.' },
  },
  {
    id: 'different-project-approval', ownerId: 'alex', existingWork: ['Alex will send Acme proposal; blocked on Acme pricing approval.'],
    sources: [message('pricing', '1', 'priya', 'Beta pricing is approved.')],
    expected: { disposition: 'clarification', mustNot: ['Resolve the Acme pricing blocker', 'Complete the Acme commitment'], reason: 'Approval identifies different work; do not cross-link it to Acme.' },
  },
  {
    id: 'ambiguous-approval-target', ownerId: 'alex', existingWork: ['Acme proposal awaits pricing approval.', 'Beta proposal awaits pricing approval.'],
    sources: [message('pricing', '1', 'priya', 'Approved.')],
    expected: { disposition: 'clarification', mustNot: ['Resolve either pricing blocker', 'Complete either commitment'], reason: 'No evidence identifies which project was approved.' },
  },
];
