import { Message, Header, Section, Context, Markdown, Actions, Button, Input, type InteractionContext } from '@copilotkit/channels';
import type { MemoryItem } from '../memory/model';
import { threadUrl } from './identity';
import type { Profile } from './profiles';
import type { WorkSnapshot } from './work';

const clean = (text: string) => text.replace(/[<>&]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[character]!));
const deadline = (item: MemoryItem) => item.deadline?.kind === 'date' ? `${item.deadline.date} (${item.deadline.timezone})` : item.deadline?.kind === 'instant' ? item.deadline.at : 'No date confirmed';
const evidence = (item: MemoryItem) => [...new Set([...item.evidence, ...(item.resolutionEvidence ?? [])].map(e => e.url))].slice(0, 3).map(url => `[Source](${url})`).join(' · ');
export function briefingText(snapshot: WorkSnapshot) {
  const { memory, profile } = snapshot;
  const lines = [snapshot.fixture ? 'Example briefing — fictional data' : 'Your work briefing', `As of ${snapshot.generatedAt}`, profile.role ? `Role: ${clean(profile.role)}` : '', ...profile.goals.map(goal => `Goal: ${clean(goal)}`)];
  const upcoming = memory.commitments.filter(item => item.deadline && item.deadline.kind !== 'unknown');
  const backlog = memory.commitments.filter(item => !item.deadline || item.deadline.kind === 'unknown');
  const sections: Array<[string, MemoryItem[]]> = [['Coming up', upcoming], ['Waiting — no resolution found in tracked threads', memory.blockers.filter(item => item.status === 'open')], ['Backlog — no date confirmed', backlog], ['Resolved dependencies — commitments remain open', memory.blockers.filter(item => item.status === 'resolved')], ['Needs clarification', memory.questions]];
  for (const [title, items] of sections) {
    if (!items.length) continue;
    lines.push(`\n**${title}**`);
    for (const item of items.slice(0, 8)) lines.push(`• ${clean(item.title)}${item.kind === 'commitment' ? ` — ${deadline(item)}` : ''}\n${evidence(item)}`);
    if (items.length > 8) lines.push(`${items.length - 8} more items are saved.`);
  }
  if (!memory.commitments.length && !memory.blockers.length && !memory.questions.length) lines.push('No work items are available from the currently readable selected threads.');
  if (memory.changes.length) lines.push(`\n${memory.changes.length} recorded change(s) since the last successful notification.`);
  lines.push('\n**Source freshness**');
  if (!snapshot.reads.length) lines.push('No threads selected. Add a Slack thread link to begin.');
  for (const read of snapshot.reads) lines.push(`• [Thread](${threadUrl(read.ref)}) — ${read.status === 'fresh' ? `read at ${read.checkedAt}` : 'unavailable; refresh required'}`);
  if (snapshot.hiddenItems) lines.push(`${snapshot.hiddenItems} saved item(s) withheld because their sources changed, were removed, or cannot be read.`);
  if (snapshot.ingestionError) lines.push(snapshot.ingestionError);
  return lines.filter(Boolean).join('\n');
}
export function BriefingCard(snapshot: WorkSnapshot) {
  // Keep Slack sections below its text budget; split on paragraph boundaries.
  const text = briefingText(snapshot), chunks: string[] = [];
  let chunk = '';
  for (const line of text.split('\n')) {
    if (chunk.length + line.length > 2400) { chunks.push(chunk); chunk = ''; }
    chunk += `${line}\n`;
  }
  if (chunk) chunks.push(chunk);
  return <Message accent="#247A65"><Header>{snapshot.fixture ? 'Example work briefing' : 'Your work briefing'}</Header>{chunks.slice(0, 12).map(value => <Section><Markdown>{value}</Markdown></Section>)}<Context>{snapshot.fixture ? 'Fictional data. Nothing has been saved to your work memory.' : 'Private to you. Missing evidence is not proof that work is complete.'}</Context></Message>;
}
export type ActionHandler = (action: string, ctx: InteractionContext<unknown>) => Promise<void>;
export function HomeCard(profile: Profile, action: ActionHandler, backgroundAvailable: boolean) {
  return <Message accent="#247A65"><Header>Intern — your work, in context</Header><Section>{profile.role ? `Role: ${profile.role}` : 'Start by telling me your role and up to three goals.'}</Section>{profile.goals.map(goal => <Section>{goal}</Section>)}<Context>{`${profile.threads.length}/10 selected threads · Weekday Singapore notifications ${profile.scheduled ? 'on' : 'off'}`}</Context><Actions>
    <Button value="brief" style="primary" onClick={ctx => action('brief', ctx)}>Refresh briefing</Button>
    <Button value="setup" onClick={ctx => action('setup', ctx)}>Edit profile</Button>
    <Button value="threads" onClick={ctx => action('threads', ctx)}>Selected threads</Button>
    <Button value="demo" onClick={ctx => action('demo', ctx)}>Example briefing</Button>
  </Actions>{backgroundAvailable && <Actions><Button value={profile.scheduled ? 'schedule-off' : 'schedule-on'} onClick={ctx => action(profile.scheduled ? 'schedule-off' : 'schedule-on', ctx)}>{profile.scheduled ? 'Pause notifications' : 'Enable weekday notifications'}</Button></Actions>}<Context>{backgroundAvailable ? 'Optional: 08:30 briefing and 09:00, 13:00, 17:00 change checks, Asia/Singapore. Enable to receive DMs.' : 'On-demand mode. Background Slack delivery is not configured.'}</Context></Message>;
}
export function SetupCard(save: (text: string, ctx: InteractionContext<unknown>) => Promise<void>) {
  return <Message><Header>Your private profile</Header><Section>Enter your role, then a | and up to three goals separated by semicolons. Example: Designer | Ship proposal; Improve onboarding</Section><Input name="profile" placeholder="Role | goal one; goal two" onSubmit={ctx => save(String(ctx.action.value ?? ''), ctx)} /><Context>You can also send: profile Designer | Ship proposal; Improve onboarding</Context></Message>;
}
export function ThreadsCard(profile: Profile, action: ActionHandler, add: (text: string, ctx: InteractionContext<unknown>) => Promise<void>) {
  return <Message><Header>Your selected threads</Header>{profile.threads.map(ref => <Section><Markdown>{`[Open selected thread](${threadUrl(ref)})`}</Markdown><Actions><Button value={threadUrl(ref)} onClick={ctx => action(`untrack ${threadUrl(ref)}`, ctx)}>Stop tracking</Button></Actions></Section>)}<Section>Paste a thread link from a channel you belong to. Only selected threads are read.</Section><Input name="thread-link" placeholder="https://your-workspace.slack.com/archives/…" onSubmit={ctx => add(String(ctx.action.value ?? ''), ctx)} /><Context>You can also send: track &lt;Slack thread URL&gt;. Removing a thread excludes its saved evidence from future briefings.</Context></Message>;
}
