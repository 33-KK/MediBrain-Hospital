import type { AnswerSource } from './grounded-answer';
import type { AnswerSection } from './qa-response';

/** Group copied facts without paraphrasing or dropping their direction/qualifiers. */
export function answerSections(sources: AnswerSource[]): AnswerSection[] {
  const groups = new Map<string, AnswerSection>();
  for (const source of sources) {
    const title = `${source.subject} · ${source.relation}`;
    let section = groups.get(title);
    if (!section) {
      section = { title, items: [] };
      groups.set(title, section);
    }
    section.items.push({ text: source.text, sourceIds: [source.id] });
  }
  return [...groups.values()];
}
