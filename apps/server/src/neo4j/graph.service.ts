import { Inject, Injectable, Logger } from '@nestjs/common';
import { NEO4J_DRIVER } from './neo4j.constants';
import neo4j from 'neo4j-driver';
import type { Driver } from 'neo4j-driver';

/** 疾病与各实体的关系映射 */export const DISEASE_RELATION_QUERIES: Record<string, string> = {
  症状: '疾病的症状',
  宜吃食物: '疾病宜吃食物',
  忌吃食物: '疾病忌吃食物',
  常用药品: '疾病使用药品',
  所需检查: '疾病所需检查',
  并发症: '疾病并发疾病',
  所属科目: '疾病所属科目',
  治疗方法: '治疗的方法',
};

export interface EntityHit {
  name: string;
  label: string;
  desc?: string;
}

export interface GraphRelation {
  relation: string;
  entity: string;
  label?: string;
  detail?: string;
}

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);

  constructor(@Inject(NEO4J_DRIVER) private readonly driver: Driver) {}

  /** 加载全部实体词典（名称→标签），供 NER 离线匹配使用 */
  async loadEntityDictionary(): Promise<Map<string, string>> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (n) RETURN n.名称 AS name, labels(n)[0] AS label`,
      );
      const dict = new Map<string, string>();
      for (const rec of result.records) {
        const name = rec.get('name') as string;
        const label = rec.get('label') as string;
        if (name) dict.set(name, label);
      }
      this.logger.log(`图谱实体词典加载完成: ${dict.size} 个实体`);
      return dict;
    } finally {
      await session.close();
    }
  }

  /** 按名称检索图谱实体（模糊匹配，任意标签） */
  async searchEntity(name: string, limit = 8): Promise<EntityHit[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (n)
         WHERE n.名称 CONTAINS $kw
         RETURN n.名称 AS name, labels(n)[0] AS label, n.简介 AS desc
         LIMIT $limit`,
        { kw: name, limit: neo4j.int(limit) },
      );
      return result.records.map((r) => ({
        name: r.get('name') as string,
        label: r.get('label') as string,
        desc: (r.get('desc') as string) ?? undefined,
      }));
    } finally {
      await session.close();
    }
  }

  /** 查询某疾病节点的完整信息（多跳关系聚合） */
  async getDiseaseInfo(name: string): Promise<{
    disease: EntityHit | null;
    relations: GraphRelation[];
  } | null> {
    const session = this.driver.session();
    try {
      const disease = await session.run(
        `MATCH (d:疾病 {名称: $name}) RETURN d.名称 AS name, d.疾病简介 AS desc, d.疾病病因 AS cause, d.预防措施 AS prevention, d.治愈概率 AS cureRate, d.治疗周期 AS cycle, d.疾病易感人群 AS atRisk`,
        { name },
      );
      if (disease.records.length === 0) return null;

      const relations: GraphRelation[] = [];
      for (const [relName, relType] of Object.entries(DISEASE_RELATION_QUERIES)) {
        const res = await session.run(
          `MATCH (d:疾病 {名称: $name})-[r:${relType}]->(t)
           RETURN t.名称 AS entity, labels(t)[0] AS label, t.简介 AS detail
           LIMIT 15`,
          { name },
        );
        for (const rec of res.records) {
          relations.push({
            relation: relName,
            entity: rec.get('entity') as string,
            label: rec.get('label') as string,
            detail: (rec.get('detail') as string) ?? undefined,
          });
        }
      }

      const rec = disease.records[0];
      return {
        disease: {
          name: rec.get('name') as string,
          label: '疾病',
          desc: rec.get('desc') ?? undefined,
        },
        relations,
      };
    } finally {
      await session.close();
    }
  }

  /** 获取单个实体的属性与邻居（用于 NER 后的目标实体查询） */
  async getEntityNeighbors(
    name: string,
  ): Promise<{ node: Record<string, unknown>; neighbors: GraphRelation[] } | null> {
    const session = this.driver.session();
    try {
      const nodeRes = await session.run(
        `MATCH (n {名称: $name}) RETURN n AS node, labels(n)[0] AS label LIMIT 1`,
        { name },
      );
      if (nodeRes.records.length === 0) return null;

      const node = nodeRes.records[0].get('node') as Record<string, unknown>;
      const { properties } = node as { properties?: Record<string, unknown> };
      const label = nodeRes.records[0].get('label') as string;

      // 出边 + 入边（药品/检查/食物等的知识主要在入边：疾病 → 实体）
      const neighborRes = await session.run(
        `MATCH (n {名称: $name})-[r]->(t) RETURN type(r) AS rel, t.名称 AS entity, labels(t)[0] AS label
         UNION ALL
         MATCH (s)-[r]->(n {名称: $name}) RETURN type(r) AS rel, s.名称 AS entity, labels(s)[0] AS label
         LIMIT 30`,
        { name },
      );
      const neighbors = neighborRes.records.map((rec) => ({
        relation: rec.get('rel') as string,
        entity: rec.get('entity') as string,
        label: rec.get('label') as string,
      }));

      return { node: properties ?? {}, neighbors };
    } finally {
      await session.close();
    }
  }
}
