import { Inject, Injectable, Logger } from '@nestjs/common';
import { NEO4J_DRIVER } from './neo4j.constants';
import neo4j from 'neo4j-driver';
import type { Driver } from 'neo4j-driver';
import { IndexTask } from './index-task';

/** 疾病与各实体的关系映射 */
export const DISEASE_RELATION_QUERIES: Record<string, string> = {
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
  attributes?: Record<string, string>;
}

export interface GraphRelation {
  relation: string;
  entity: string;
  label?: string;
  detail?: string;
  direction?: 'outgoing' | 'incoming';
}

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);

  constructor(@Inject(NEO4J_DRIVER) private readonly driver: Driver) {}

  async ensureIndexTaskSchema(): Promise<void> {
    await this.driver.executeQuery(
      'CREATE CONSTRAINT medibrain_index_task_key IF NOT EXISTS FOR (task:_MediBrainIndexTask) REQUIRE task.key IS UNIQUE',
    );
  }

  async claimIndexTasks(owner: string): Promise<IndexTask[]> {
    const session = this.driver.session();
    const tasks: IndexTask[] = [];
    const deadline = Date.now() + 10_000;
    try {
      // Small transactions limit lock contention. Retry transient deadlocks
      // here only, with a deadline that leaves time before the lease expires.
      for (let index = 0; index < 10; index++) {
        if (Date.now() >= deadline) break;
        let result: Awaited<ReturnType<typeof session.run>> | undefined;
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            result = await session.run(
              `MATCH (task:_MediBrainIndexTask)
         WHERE coalesce(task.leaseUntil, 0) < timestamp()
         WITH task ORDER BY task.updatedAt, task.key LIMIT 1
         SET task.leaseOwner = CASE
           WHEN coalesce(task.leaseUntil, 0) < timestamp() THEN $owner
           ELSE task.leaseOwner END
         SET task.leaseUntil = CASE WHEN task.leaseOwner = $owner
           THEN timestamp() + 60000 ELSE task.leaseUntil END
         WITH task WHERE task.leaseOwner = $owner
         RETURN task.key AS key, task.name AS name, task.label AS label,
                task.revision AS revision`,
              { owner },
              { timeout: Math.max(1, Math.min(1500, deadline - Date.now())) },
            );
            break;
          } catch (error) {
            if (
              (error as { code?: string }).code !==
                'Neo.TransientError.Transaction.DeadlockDetected' ||
              attempt === 3 ||
              Date.now() >= deadline
            ) {
              if (!tasks.length) throw error;
              this.logger.warn('索引领取中断，已领取任务继续处理');
              return tasks;
            }
            await new Promise((resolve) =>
              setTimeout(resolve, 25 + Math.random() * 75 * (attempt + 1)),
            );
          }
        }
        if (!result) break;
        if (!result.records.length) break;
        tasks.push(
          ...result.records.map((record) => ({
            key: record.get('key') as string,
            name: record.get('name') as string,
            label: record.get('label') as string,
            revision: record.get('revision') as string,
          })),
        );
      }
      return tasks;
    } finally {
      await session.close();
    }
  }

  async finishIndexTask(task: IndexTask, owner: string, succeeded: boolean) {
    const session = this.driver.session();
    try {
      await session.run(
        succeeded
          ? `MATCH (task:_MediBrainIndexTask {key: $key})
             SET task.lockVersion = coalesce(task.lockVersion, 0) + 1
             WITH task
             WHERE task.leaseOwner = $owner AND task.revision = $revision DELETE task`
          : `MATCH (task:_MediBrainIndexTask {key: $key})
             SET task.lockVersion = coalesce(task.lockVersion, 0) + 1
             WITH task
             WHERE task.leaseOwner = $owner REMOVE task.leaseOwner, task.leaseUntil`,
        { key: task.key, revision: task.revision, owner },
        { timeout: 5000 },
      );
      if (succeeded)
        await session.run(
          `MATCH (task:_MediBrainIndexTask {key: $key})
           SET task.lockVersion = coalesce(task.lockVersion, 0) + 1
           WITH task
           WHERE task.leaseOwner = $owner REMOVE task.leaseOwner, task.leaseUntil`,
          { key: task.key, owner },
          { timeout: 5000 },
        );
    } finally {
      await session.close();
    }
  }

  async getEntitySnapshot(
    name: string,
    label: string,
  ): Promise<{ desc?: string } | null> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        'MATCH (n {名称: $name}) WHERE $label IN labels(n) RETURN coalesce(n.疾病简介, n.简介) AS desc LIMIT 1',
        { name, label },
        { timeout: 5000 },
      );
      return result.records.length
        ? { desc: result.records[0].get('desc') as string | undefined }
        : null;
    } finally {
      await session.close();
    }
  }

  /** 加载全部实体词典（名称→标签），供 NER 离线匹配使用 */
  async loadEntityDictionary(): Promise<Map<string, string>> {
    const session = this.driver.session();
    try {
      const result = await session.run(
        `MATCH (n) WHERE n.名称 IS NOT NULL
         RETURN n.名称 AS name, labels(n)[0] AS label ORDER BY name, label`,
        {},
        { timeout: 5000 },
      );
      const dict = new Map<string, string>();
      for (const rec of result.records) {
        const name = rec.get('name') as string;
        const label = rec.get('label') as string;
        // A disease may also be listed as a symptom. Keep its disease identity
        // so disease questions cannot bypass the disease conflict guard.
        if (name && (!dict.has(name) || label === '疾病'))
          dict.set(name, label);
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
    reviewRequired?: boolean;
    reviewReason?: string;
  } | null> {
    const session = this.driver.session();
    try {
      const disease = await session.run(
        `MATCH (d:疾病 {名称: $name})
         OPTIONAL MATCH (d)-[r]->(t) WHERE type(r) IN $relationTypes
           AND NOT (type(r) = '疾病并发疾病' AND d = t)
         WITH d, type(r) AS rel, collect({entity: t.名称, label: labels(t)[0], detail: t.简介})[0..15] AS targets
         RETURN elementId(d) AS nodeId, properties(d) AS properties,
                collect({type: rel, targets: targets}) AS groups`,
        { name, relationTypes: Object.values(DISEASE_RELATION_QUERIES) },
        { timeout: 5000 },
      );
      if (disease.records.length === 0) return null;
      if (disease.records.length > 1)
        return {
          disease: null,
          relations: [],
          reviewRequired: true,
          reviewReason: '同名疾病记录存在属性冲突，待专业复核。',
        };

      const relations: GraphRelation[] = [];
      const record = disease.records[0];
      const properties = record.get('properties') as Record<string, unknown>;
      const groups = record.get('groups') as {
        type: string;
        targets: { entity: string; label: string; detail?: string }[];
      }[];
      const namesByType = Object.fromEntries(
        Object.entries(DISEASE_RELATION_QUERIES).map(([label, type]) => [
          type,
          label,
        ]),
      );
      for (const group of groups) {
        for (const target of group.targets) {
          if (!target.entity || !namesByType[group.type]) continue;
          relations.push({
            relation: namesByType[group.type],
            entity: target.entity,
            label: target.label,
            detail: target.detail ?? undefined,
          });
        }
      }

      const attributeFields: Record<string, string> = {
        病因: '疾病病因',
        预防: '预防措施',
        治愈概率: '治愈概率',
        治疗周期: '治疗周期',
        易感人群: '疾病易感人群',
      };
      const attributes: Record<string, string> = {};
      for (const [label, field] of Object.entries(attributeFields)) {
        const value = properties[field];
        const text =
          typeof value === 'string'
            ? value
            : typeof value === 'number' || neo4j.isInt(value)
              ? value.toString()
              : Array.isArray(value)
                ? value.join('、')
                : '';
        if (text.trim()) attributes[label] = text;
      }
      return {
        disease: {
          name: String(properties['名称']),
          label: '疾病',
          desc: (properties['疾病简介'] ?? properties['简介']) as
            string | undefined,
          attributes,
        },
        relations,
      };
    } finally {
      await session.close();
    }
  }

  /** 获取单个实体的属性与邻居（用于 NER 后的目标实体查询） */
  async getEntityNeighbors(name: string): Promise<{
    node: Record<string, unknown>;
    neighbors: GraphRelation[];
  } | null> {
    const session = this.driver.session();
    try {
      const nodeRes = await session.run(
        `MATCH (n {名称: $name}) RETURN n AS node, labels(n)[0] AS label LIMIT 1`,
        { name },
        { timeout: 5000 },
      );
      if (nodeRes.records.length === 0) return null;

      const node = nodeRes.records[0].get('node') as Record<string, unknown>;
      const { properties } = node as { properties?: Record<string, unknown> };

      // 出边 + 入边（药品/检查/食物等的知识主要在入边：疾病 → 实体）
      const neighborRes = await session.run(
        `MATCH (n {名称: $name})-[r]->(t)
         WHERE NOT (type(r) = '疾病并发疾病' AND n = t)
         RETURN type(r) AS rel, t.名称 AS entity, labels(t)[0] AS label, 'outgoing' AS direction
         UNION ALL
         MATCH (s)-[r]->(n {名称: $name})
         WHERE NOT (type(r) = '疾病并发疾病' AND s = n)
         RETURN type(r) AS rel, s.名称 AS entity, labels(s)[0] AS label, 'incoming' AS direction
         LIMIT 30`,
        { name },
        { timeout: 5000 },
      );
      const neighbors = neighborRes.records.map((rec) => ({
        relation: rec.get('rel') as string,
        entity: rec.get('entity') as string,
        label: rec.get('label') as string,
        direction: rec.get('direction') as 'outgoing' | 'incoming',
      }));

      return { node: properties ?? {}, neighbors };
    } finally {
      await session.close();
    }
  }
}
