import { Injectable, Logger } from '@nestjs/common';
import { GraphService, GraphRelation } from '../neo4j/graph.service';
import { EntityRecognitionService } from '../entity/entity-recognition.service';
import { LlmGateway } from '../llm/llm.gateway';
import { EmbeddingService } from '../embedding/embedding.service';

export interface QaResponse {
  answer: string;
  entities: { name: string; type: string }[];
  dimension: string | null;
  sources: { entity: string; relation: string }[];
  provider: string;
  graphMatched: boolean;
  /** 是否为向量检索兜底命中 */
  vectorMatched?: boolean;
  /** 向量检索候选（调试用） */
  vectorCandidates?: { name: string; type: string; score: number }[];
}

@Injectable()
export class QaService {
  private readonly logger = new Logger(QaService.name);

  constructor(
    private readonly graph: GraphService,
    private readonly entity: EntityRecognitionService,
    private readonly llm: LlmGateway,
    private readonly embedding: EmbeddingService,
  ) {}

  /** 不同身份的回答风格约束 */
  private readonly IDENTITY_STYLES: Record<string, string> = {
    医生: '使用规范医学术语，可提及药物通用名，回答需专业、精准、简洁。',
    护士: '使用护理专业视角回答，可适当提及日常护理与观察要点。',
    药师: '侧重药品用法、用量与相互作用，提醒用药注意事项。',
    医学生: '使用专业术语并简要解释病理机制，帮助理解学习。',
    患者: '使用通俗易懂的语言，避免复杂医学术语；回答末尾附加一句就医提醒：本回答仅供参考，如有不适请及时就医。',
    患者家属: '使用通俗语言，侧重饮食、起居与照护建议；回答末尾附加就医提醒。',
    普通用户: '使用通俗语言回答，保持客观准确；回答末尾附加就医提醒。',
  };

  async ask(question: string, identity?: string): Promise<QaResponse> {
    // 1. 实体识别 + 意图分析
    const entities = this.entity.recognize(question);
    const { dimension } = this.entity.analyzeIntent(question);
    this.logger.log(
      `实体: ${JSON.stringify(entities)} | 意图维度: ${dimension ?? '通用'}`,
    );

    // 2. 图谱查询：按维度定向查询目标实体
    const dimensionToRelation: Record<string, string> = {
      症状: '症状',
      宜吃食物: '宜吃食物',
      忌吃食物: '忌吃食物',
      常用药品: '常用药品',
      检查: '所需检查',
      并发症: '并发症',
      所属科目: '所属科目',
      治疗方法: '治疗方法',
    };
    const targetRelation = dimension ? dimensionToRelation[dimension] : null;

    const graphFacts: { entity: string; relations: GraphRelation[] }[] = [];
    for (const ent of entities) {
      const info = await this.graph.getDiseaseInfo(ent.name);
      if (info) {
        const filtered = targetRelation
          ? info.relations.filter((r) => r.relation === targetRelation)
          : info.relations;
        graphFacts.push({ entity: ent.name, relations: filtered });
      }
    }

    let graphMatched = graphFacts.some((f) => f.relations.length > 0);

    // 2.5 向量兜底：规则未命中时用 embedding 检索候选实体，再查图谱事实
    let vectorMatched = false;
    let vectorCandidates: { name: string; type: string; score: number }[] = [];
    if (!graphMatched) {
      // 同义归一化 + 去重：布洛芬/布洛芬片 只保留最高分候选
      const deduped = this.entity.dedupeCandidates(
        (await this.embedding.searchCandidates(question)).map((c) => ({
          name: c.name,
          type: c.type,
          score: Number(c.score.toFixed(4)),
        })),
      );
      vectorCandidates = deduped;
      for (const cand of deduped) {
        if (graphFacts.some((f) => f.entity === cand.name)) continue;
        const info = await this.graph.getDiseaseInfo(cand.name);
        if (info) {
          const filtered = targetRelation
            ? info.relations.filter((r) => r.relation === targetRelation)
            : info.relations;
          if (filtered.length > 0) {
            graphFacts.push({ entity: cand.name, relations: filtered });
            vectorMatched = true;
            this.logger.log(
              `向量兜底命中: ${cand.name}[${cand.type}] score=${cand.score.toFixed(4)}`,
            );
            continue;
          }
        }
        // 非疾病实体：查邻居关系，作为补充事实
        const neighbors = await this.graph.getEntityNeighbors(cand.name);
        if (neighbors && neighbors.neighbors.length > 0) {
          graphFacts.push({ entity: cand.name, relations: neighbors.neighbors });
          vectorMatched = true;
          this.logger.log(
            `向量兜底命中(邻居): ${cand.name}[${cand.type}] score=${cand.score.toFixed(4)}`,
          );
        }
      }
      graphMatched = graphFacts.some((f) => f.relations.length > 0);
    }

    // 3. 组装图谱事实文本
    const factText = this.buildFactText(graphFacts);

    // 4. 构建 prompt 请求 LLM（失败降级为图谱直答）
    const styleRule = identity
      ? this.IDENTITY_STYLES[identity]
      : this.IDENTITY_STYLES['普通用户'];
    let answer: string;
    try {
      answer = (await this.llm.chat(
        [
          {
            role: 'system',
            content: `你是医疗知识图谱问答助手。请严格基于提供的图谱事实回答，不要编造。如果图谱事实不足，请明确告知"图谱中未找到相关信息"。回答要简洁、分点，只回答用户问的维度。\n【回答风格要求】${styleRule ?? this.IDENTITY_STYLES['普通用户']}`,
          },
          {
            role: 'user',
            content: `【图谱事实】\n${factText || '（无图谱命中）'}\n\n【用户问题】\n${question}\n\n请基于图谱事实回答。`,
          },
        ],
      )) as string;
    } catch (err) {
      this.logger.warn(`LLM 调用失败，降级为图谱直答: ${(err as Error).message}`);
      answer = this.buildFallbackAnswer(graphFacts, question);
    }

    return {
      answer,
      entities: entities.map((e) => ({ name: e.name, type: e.type })),
      dimension,
      sources: graphFacts.flatMap((g) =>
        g.relations.map((r) => ({
          entity: r.entity,
          relation: r.relation,
          label: r.label ?? 'unknown',
        })),
      ),
      provider: this.llm.providerName,
      graphMatched,
      vectorMatched,
      vectorCandidates: vectorCandidates.length > 0 ? vectorCandidates : undefined,
    };
  }

  private buildFactText(graphFacts: { entity: string; relations: GraphRelation[] }[]): string {
    if (graphFacts.length === 0) return '';
    const lines: string[] = [];
    for (const fact of graphFacts) {
      if (fact.relations.length === 0) continue;
      lines.push(`# 实体：${fact.entity}`);
      const grouped = new Map<string, string[]>();
      for (const rel of fact.relations) {
        if (!grouped.has(rel.relation)) grouped.set(rel.relation, []);
        grouped.get(rel.relation)!.push(rel.entity);
      }
      for (const [rel, items] of grouped) {
        lines.push(`- ${rel}：${items.slice(0, 10).join('、')}`);
      }
    }
    return lines.join('\n');
  }

  private buildFallbackAnswer(
    graphFacts: { entity: string; relations: GraphRelation[] }[],
    question: string,
  ): string {
    const matched = graphFacts.find((f) => f.relations.length > 0);
    if (!matched) {
      return `抱歉，图谱中未找到与"${question}"相关的医学信息。`;
    }
    const grouped = new Map<string, string[]>();
    for (const rel of matched.relations) {
      if (!grouped.has(rel.relation)) grouped.set(rel.relation, []);
      grouped.get(rel.relation)!.push(rel.entity);
    }
    const lines = [`根据医学知识图谱，关于「${matched.entity}」的信息如下：`];
    for (const [rel, items] of grouped) {
      lines.push(`- ${rel}：${items.slice(0, 8).join('、')}`);
    }
    return lines.join('\n');
  }
}
