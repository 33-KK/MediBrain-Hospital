/** These boundaries are shared by retrieval and the reader; numbers are per page. */
export const MAX_PASSAGE_CHARACTERS = 1200;

export interface DocumentPassage {
  paragraph: number;
  text: string;
}

export interface PassagePage {
  page: number | null;
  text: string;
}

export interface RankedPassage extends DocumentPassage {
  page: number | null;
  score: number;
}

/** Preserve source wording, including line breaks, without joining PDF columns. */
export function splitDocumentPassages(text: string): DocumentPassage[] {
  const passages: DocumentPassage[] = [];
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n[\t ]*\n+/);
  for (const block of blocks) {
    let remaining = block.trim();
    while (remaining) {
      let length = Math.min(MAX_PASSAGE_CHARACTERS, remaining.length);
      if (remaining.length > length) {
        const window = remaining.slice(0, length);
        let boundary = -1;
        for (const match of window.matchAll(/[。！？.!?；;\n]/g)) {
          if (match.index >= MAX_PASSAGE_CHARACTERS / 2)
            boundary = match.index + 1;
        }
        if (boundary > 0) length = boundary;
        // Never split a Unicode surrogate pair at a hard length boundary.
        const last = remaining.charCodeAt(length - 1);
        if (last >= 0xd800 && last <= 0xdbff) length--;
      }
      const excerpt = remaining.slice(0, length).trim();
      if (excerpt)
        passages.push({ paragraph: passages.length + 1, text: excerpt });
      remaining = remaining.slice(length).trim();
    }
  }
  return passages;
}

const englishStopwords = new Set(
  'a an and are as at be by can could did do does for from had has have how i in is it its me my of on or our should tell that the their them there these they this those to us was were what when where which who why will with would you your document article guideline about'.split(
    ' ',
  ),
);
const chineseStopwords =
  /请问|请说|请|根据|关于|这份|该份|这个|该文|文档|资料|指南|原文|介绍|相关|有什么|有没有|什么|哪些|如何|怎样|怎么|多少|我想|知道|一下|患者|病人|还有|那么|可以|需要|应该|能否|是否|注意|主要|常见|建议|推荐|的|呢|吗|了|与|和|中/g;

function terms(text: string): Set<string> {
  const result = new Set<string>();
  for (const token of text.toLowerCase().match(/[a-z][a-z-]*/g) ?? []) {
    if (token.length > 1 && !englishStopwords.has(token)) result.add(token);
  }
  for (const run of text
    .replace(chineseStopwords, ' ')
    .match(/[\p{Script=Han}]+/gu) ?? []) {
    for (let index = 0; index + 1 < run.length; index++)
      result.add(run.slice(index, index + 2));
  }
  return new Set([...result].slice(0, 120));
}

const intents = [
  {
    question: /症状|表现|征兆|symptoms?|signs?/i,
    evidence: /症状|表现|征兆|\bsymptoms?\b|\bsigns?\b/i,
  },
  {
    question: /饮食|食物|食养|营养|吃|diet|foods?|eat|nutrition/i,
    evidence:
      /饮食|食物|食养|营养|摄入|食用|膳食|\bdiet\w*\b|\bfoods?\b|\beat\w*\b|\bnutrition\w*\b/i,
  },
  {
    question: /不能|不宜|忌口|忌吃|禁忌|限制|避免|avoid|restrict|limit/i,
    evidence:
      /不能|不宜|禁忌|限制|避免|减少|不超过|\bavoid\w*\b|\brestrict\w*\b|\blimit\w*\b|\breduc\w*\b/i,
  },
  {
    question: /治疗|用药|药物|药品|treat|medication|medicine|drugs?/i,
    evidence:
      /治疗|用药|药物|药品|\btreat\w*\b|\bmedication\w*\b|\bmedicines?\b|\bdrugs?\b/i,
  },
  {
    question: /检查|诊断|检测|diagnos|tests?|screen/i,
    evidence: /检查|诊断|检测|筛查|\bdiagnos\w*\b|\btests?\b|\bscreen\w*\b/i,
  },
  {
    question: /病因|原因|风险|危险|causes?|risk/i,
    evidence: /病因|原因|风险|危险|\bcaus\w*\b|\brisks?\b|\bfactors?\b/i,
  },
  {
    question: /预防|防止|prevent/i,
    evidence: /预防|防止|\bprevent\w*\b/i,
  },
];

function hasTerm(text: string, term: string): boolean {
  return /^[a-z-]+$/.test(term)
    ? new RegExp(`\\b${term}\\b`, 'i').test(text)
    : text.includes(term);
}

function hits(text: string, keywords: Set<string>): number {
  let count = 0;
  for (const term of keywords) if (hasTerm(text, term)) count++;
  return count;
}

/** Lexical first release: a title/previous question can never be the evidence. */
export function rankDocumentPassages(
  document: { title: string; topicsZh: string[]; pages: PassagePage[] },
  question: string,
  previousQuestion?: string,
): { passages: RankedPassage[]; totalMatched: number } {
  const background = terms([document.title, ...document.topicsZh].join(' '));
  let keywords = terms(question);
  const specific = new Set(
    [...keywords].filter((term) => !background.has(term)),
  );
  if (specific.size) keywords = specific;
  let matchingIntents = intents.filter((intent) =>
    intent.question.test(question),
  );
  const shortFollowup =
    question.length <= 32 &&
    /呢[?？。]?\s*$|^(?:那|它|这|该|还|以及|那么|what about|how about|and\b)/i.test(
      question,
    );
  const previous =
    shortFollowup && previousQuestion
      ? terms(previousQuestion)
      : new Set<string>();
  // A non-specific follow-up may reuse retrieval keywords, never answer text.
  if (!keywords.size && previous.size) {
    keywords = new Set([...previous].filter((term) => !background.has(term)));
    matchingIntents = intents.filter((intent) =>
      intent.question.test(previousQuestion ?? ''),
    );
  }
  if (!keywords.size && !matchingIntents.length)
    return { passages: [], totalMatched: 0 };
  let focus = question.toLowerCase();
  for (const name of [document.title, ...document.topicsZh].filter(Boolean))
    focus = focus.split(name.toLowerCase()).join(' ');
  for (const intent of matchingIntents)
    focus = focus.replace(new RegExp(intent.evidence.source, 'gi'), ' ');
  const focusTerms = terms(focus);
  const restriction = intents[2];
  const ranked: RankedPassage[] = [];
  let paragraphCount = 0;
  for (const page of document.pages) {
    const passages = splitDocumentPassages(page.text);
    paragraphCount += passages.length;
    if (paragraphCount > 4000)
      throw new RangeError('资料段落过多，请使用原文阅读');
    for (const passage of passages) {
      const plain = passage.text.trim();
      const compactTitle = document.title.toLowerCase().replace(/\s+/g, '');
      const body = plain
        .split('\n')
        .filter((line) => {
          const compact = line.toLowerCase().replace(/\s+/g, '');
          return compact && !compactTitle.includes(compact);
        })
        .join('\n');
      // Titles, running page headers and isolated table labels are not answers.
      if (
        body.length < 24 &&
        !(body.length >= 12 && /[。.!?！？；;]/.test(body))
      )
        continue;
      const keywordHits = hits(body, keywords);
      const intentHits = matchingIntents.filter((intent) =>
        intent.evidence.test(body),
      ).length;
      if (
        matchingIntents.length
          ? !intentHits
          : keywordHits < Math.min(2, keywords.size)
      )
        continue;
      if (
        restriction.question.test(question) &&
        !restriction.evidence.test(body)
      )
        continue;
      if (
        matchingIntents.length &&
        focusTerms.size &&
        hits(body, focusTerms) < Math.min(2, focusTerms.size)
      )
        continue;
      const score =
        (intentHits * 8 + keywordHits * 2 + hits(plain, previous) * 0.25) /
        (1 + plain.length / 1500);
      ranked.push({ ...passage, page: page.page, score });
    }
  }
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      (a.page ?? 0) - (b.page ?? 0) ||
      a.paragraph - b.paragraph,
  );
  return { passages: ranked.slice(0, 6), totalMatched: ranked.length };
}

/** Optional model output is a selection of IDs, never rewritten source content. */
export function validateDocumentSelection(
  response: string,
  ids: string[],
): string[] {
  if (response.length > 2048) throw new Error('文档片段选择响应过大');
  const parsed: unknown = JSON.parse(response);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('文档片段选择对象无效');
  const object = parsed as Record<string, unknown>;
  if (Object.keys(object).length !== 1 || !Array.isArray(object.passageIds))
    throw new Error('只允许返回片段编号');
  const selected: unknown[] = object.passageIds;
  if (
    !selected.length ||
    selected.length > 4 ||
    new Set(selected).size !== selected.length ||
    selected.some((id) => typeof id !== 'string' || !ids.includes(id))
  )
    throw new Error('片段编号未知、重复或数量无效');
  return selected as string[];
}
