import type { MemoryItem } from './model';

export const normalizeTaskTitle = (text: string) => text.normalize('NFKC').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const contains = (text: string, phrase: string) => Boolean(phrase) && ` ${text} `.includes(` ${phrase} `);
const generic = new Set('a an the i my our your this that it task tasks please mark change correct rename deadline date to on for of and is was be done complete completed send sent review update set move'.split(' '));

/** Conservative lexical guard, not an intent classifier. Ambiguity needs a new
 * owner message naming a task/ID; model-supplied taskId alone never disambiguates. */
export function assertTaskSelection(tasks: MemoryItem[], selectedId: string, currentText: string) {
  const text = normalizeTaskTitle(currentText);
  const explicit = tasks.filter(task => contains(text, normalizeTaskTitle(task.id)));
  let candidates = explicit;
  if (!explicit.length) {
    if (tasks.length === 1) return;
    const exact = tasks.filter(task => contains(text, normalizeTaskTitle(task.title)));
    if (exact.length) candidates = exact;
    else {
      const words = tasks.map(task => new Set(normalizeTaskTitle(task.title).split(' ').filter(w => w && !generic.has(w))));
      candidates = tasks.filter((_task, i) => [...words[i]].some(word => contains(text, word)
        && words.every((other, j) => j === i || !other.has(word))));
    }
  }
  if (candidates.length !== 1 || candidates[0].id !== selectedId) {
    throw new Error('Task selection needs clarification. Ask the owner to name one specific task or copy its exact task ID; do not guess or retry another ID from the same vague message.');
  }
}

export function assertUniqueTaskTitle(tasks: MemoryItem[], title: string, exceptId?: string) {
  const normalized = normalizeTaskTitle(title);
  if (!normalized) throw new Error('Task title needs clarification: include descriptive words.');
  const duplicate = tasks.find(task => task.id !== exceptId && normalizeTaskTitle(task.title) === normalized);
  if (duplicate) throw new Error(`Possible duplicate task already exists: ${duplicate.title} (ID ${duplicate.id}). Ask whether this is the existing task or separate work. Do not merge deadlines, invent a different title, or create another record without clarification.`);
}
