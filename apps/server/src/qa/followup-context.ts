import type { QaResponse } from './qa-response';

export interface FollowupResolution {
  resolvedQuestion: string;
  inheritedEntities: string[];
  needsClarification: boolean;
}

/** Only the latest turn's explicit subject is retained. Model prose is never context evidence. */
export function previousTopics(snapshot?: QaResponse): string[] {
  if (!snapshot) return [];
  if (snapshot.context?.needsClarification)
    return snapshot.context.inheritedEntities;
  // Vector guesses cannot establish a disease for subsequent turns.
  if (snapshot.vectorMatched) return [];
  return [
    ...new Set(
      snapshot.entities
        .filter((item) => item.type === '疾病')
        .map((item) => item.name),
    ),
  ];
}

export function resolveFollowup(
  question: string,
  explicitEntities: { name: string; type: string }[],
  dimension: string | null,
  topics: string[],
): FollowupResolution {
  const result = {
    resolvedQuestion: question,
    inheritedEntities: [] as string[],
    needsClarification: false,
  };
  if (explicitEntities.length) return result;
  const short = question.trim().length <= 80;
  const referential =
    /^(?:那|那么|这|这个|这种病|这个病|该病|它|还有|然后)(?:呢|怎么样|还有什么|有什么)?[？?。.]*$/.test(
      question.trim(),
    );
  const medical =
    (!!dimension && !['简介', '治疗方法'].includes(dimension)) ||
    /治疗|怎么治|疗法|疾病|剂量|用量|副作用|注意事项/.test(question) ||
    /^(?:是什么|介绍一下|怎么办|注意什么)[？?。呢]*$/.test(question.trim());
  if (!short || (!medical && !referential)) return result;
  // A missing dictionary entity does not mean the user omitted their subject.
  // Only known question/facet words may disappear; unknown disease names stay.
  const remainder = question
    .trim()
    .replace(/[\s？?。！!，,、：:]/g, '')
    .replace(
      /^(?:那么|这种病|这个病|这种疾病|这个疾病|该病|疾病|这个|这种|还有|然后|它|那|这)/,
      '',
    )
    .replace(
      /注意事项|治疗周期|治愈概率|易感人群|所属科目|常用药品|药物相互作用|禁忌药品|副作用|检查项目|治疗方法|治疗方案|宜吃食物|忌吃食物|饮食|食物|食养|营养|症状|表现|征兆|检查|诊断|病因|原因|预防|治疗|治愈|疗法|用药|药物|药品|剂量|用量|并发症|禁忌/g,
      ' ',
    )
    .replace(
      /需要|应该|能否|是否|怎么|如何|哪些|什么|多少|可以|不能|不宜|避免|限制|注意|建议|主要|常见|具体|介绍|一下|每天|每日|一次|一般|大概|多久|多长|时间|人群|年龄|到底|有什么|有没有|还有|那么|怎么样|怎么办|是什么|请问|请|做|吃|用|服|能|要|的|呢|吗|了|还/g,
      '',
    )
    .trim();
  if (remainder) return { ...result, needsClarification: true };
  const unique = [...new Set(topics)];
  if (unique.length === 1) {
    return {
      resolvedQuestion: `${unique[0]}：${question}`,
      inheritedEntities: unique,
      needsClarification: false,
    };
  }
  return { ...result, inheritedEntities: unique, needsClarification: true };
}

export function clarificationResponse(
  resolution: FollowupResolution,
): QaResponse {
  return {
    answer:
      resolution.inheritedEntities.length > 1
        ? `上一轮涉及${resolution.inheritedEntities.map((name) => `「${name}」`).join('、')}，请明确本次要询问哪一种疾病。`
        : '请补充您要询问的疾病或具体医学主题，再继续提问。',
    entities: [],
    dimension: null,
    sources: [],
    provider: 'context',
    graphMatched: false,
    resolvedQuestion: resolution.resolvedQuestion,
    context: {
      inheritedEntities: resolution.inheritedEntities,
      needsClarification: true,
    },
    grounding: { mode: 'graph-facts', modelAccepted: false, omitted: 0 },
  };
}
