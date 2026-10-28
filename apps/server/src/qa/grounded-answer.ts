import type { GraphRelation } from '../neo4j/graph.service';

export interface GraphFact {
  entity: string;
  relations: GraphRelation[];
}

export interface AnswerSource {
  id: string;
  subject: string;
  entity: string;
  relation: string;
  label: string;
  direction: 'outgoing' | 'incoming';
  text: string;
}

/** Evidence is copied from graph records. No model-authored text is rendered. */
export function collectEvidence(facts: GraphFact[]): {
  sources: AnswerSource[];
  omitted: number;
} {
  const sources: AnswerSource[] = [];
  const seen = new Set<string>();
  const groups = new Map<string, number>();
  let omitted = 0;
  for (const fact of facts) {
    for (const relation of fact.relations) {
      if (!relation.entity?.trim()) continue;
      const direction = relation.direction ?? 'outgoing';
      const key = JSON.stringify([
        fact.entity,
        relation.relation,
        relation.entity,
        direction,
      ]);
      if (seen.has(key)) continue;
      seen.add(key);
      const group = JSON.stringify([fact.entity, relation.relation, direction]);
      const count = groups.get(group) ?? 0;
      if (count >= 10 || sources.length >= 40) {
        omitted++;
        continue;
      }
      groups.set(group, count + 1);
      sources.push({
        id: `F${sources.length + 1}`,
        subject: fact.entity,
        entity: relation.entity,
        relation: relation.relation,
        label: relation.label ?? 'unknown',
        direction,
        text:
          direction === 'incoming'
            ? `${relation.entity} --${relation.relation}--> ${fact.entity}`
            : `${fact.entity} · ${relation.relation}：${relation.entity}`,
      });
    }
  }
  return { sources, omitted };
}

/** Require an exact permutation: the model cannot add, omit or rewrite facts. */
export function validateFactOrder(
  response: string,
  sources: AnswerSource[],
): AnswerSource[] {
  if (typeof response !== 'string' || response.length > 4096)
    throw new Error('事实编号响应无效');
  const parsed: unknown = JSON.parse(response);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('必须返回事实编号对象');
  const object = parsed as Record<string, unknown>;
  if (Object.keys(object).length !== 1 || !Array.isArray(object.factIds))
    throw new Error('不允许返回事实编号以外的内容');
  const ids: unknown[] = object.factIds;
  const byId = new Map(sources.map((source) => [source.id, source]));
  if (
    ids.length !== sources.length ||
    new Set(ids).size !== sources.length ||
    ids.some((id) => typeof id !== 'string' || !byId.has(id))
  )
    throw new Error('事实编号存在未知、重复或遗漏项');
  return (ids as string[]).map((id) => byId.get(id)!);
}

export function renderEvidence(
  sources: AnswerSource[],
  omitted: number,
): string {
  return [
    '图谱记录：',
    ...sources.map((source) => `- ${source.text} [${source.id}]`),
    ...(omitted
      ? [`另有至少 ${omitted} 条记录未展示，可在疾病详情中查看。`]
      : []),
  ].join('\n');
}
