import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { NEO4J_DRIVER } from '../neo4j/neo4j.constants';
import neo4j from 'neo4j-driver';
import type { Driver } from 'neo4j-driver';
import { GRAPH_LABELS, GRAPH_RELATION_TYPES } from './dto/graph.dto';

export interface NodeRow {
  name: string;
  label: string;
  properties: Record<string, string | number>;
}

function toPlain(value: unknown): string | number {
  if (typeof value === 'bigint' || typeof value === 'number') return Number(value);
  return String(value ?? '');
}

@Injectable()
export class GraphManageService {
  constructor(@Inject(NEO4J_DRIVER) private readonly driver: Driver) {}

  /** 元数据：可管理标签与关系类型 */
  getMeta() {
    return {
      labels: GRAPH_LABELS,
      relationTypes: GRAPH_RELATION_TYPES,
    };
  }

  /** 分页查询节点（支持按标签/关键词过滤） */
  async listNodes(params: {
    label?: string;
    kw?: string;
    page: number;
    pageSize: number;
  }): Promise<{ list: NodeRow[]; total: number }> {
    const { label, kw, page, pageSize } = params;
    const where: string[] = [];
    if (label) where.push('labels(n)[0] = $label');
    if (kw) where.push('n.名称 CONTAINS $kw');
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const session = this.driver.session();
    try {
      const countRes = await session.run(`MATCH (n) ${whereClause} RETURN count(n) AS total`, {
        label,
        kw,
      });
      const listRes = await session.run(
        `MATCH (n) ${whereClause}
           RETURN n.名称 AS name, labels(n)[0] AS label, n AS node
           ORDER BY n.名称
           SKIP $skip LIMIT $limit`,
        {
          label,
          kw,
          skip: neo4j.int((page - 1) * pageSize),
          limit: neo4j.int(pageSize),
        },
      );

      const total = countRes.records[0]?.get('total') ?? 0;
      const list = listRes.records.map((r) => {
        const node = r.get('node') as { properties: Record<string, unknown> };
        return {
          name: r.get('name') as string,
          label: r.get('label') as string,
          properties: Object.fromEntries(
            Object.entries(node.properties).map(([k, v]) => [k, toPlain(v)]),
          ),
        };
      });
      return { list, total: Number(total) };
    } finally {
      await session.close();
    }
  }

  /** 创建节点（名称同标签下唯一） */
  async createNode(params: {
    label: string;
    properties: Record<string, string | number>;
  }): Promise<NodeRow> {
    const { label, properties } = params;
    const name = String(properties['名称'] ?? '');
    if (!name) throw new BadRequestException('节点属性必须包含"名称"');

    const session = this.driver.session();
    try {
      const exist = await session.run(
        `MATCH (n) WHERE labels(n)[0] = $label AND n.名称 = $name RETURN n LIMIT 1`,
        { label, name },
      );
      if (exist.records.length > 0) {
        throw new BadRequestException(`节点已存在: ${label}/${name}`);
      }
      const props = { ...properties, 名称: name };
      await session.run(`CREATE (n:${label} $props)`, { props });
      return { name, label, properties: props };
    } finally {
      await session.close();
    }
  }

  /** 更新节点属性（名称可改，但需保证不与其他节点冲突） */
  async updateNode(params: {
    label: string;
    name: string;
    properties: Record<string, string | number>;
  }): Promise<NodeRow> {
    const { label, name, properties } = params;
    const newName = properties['名称'] !== undefined ? String(properties['名称']) : name;

    const session = this.driver.session();
    try {
      const exist = await session.run(
        `MATCH (n) WHERE labels(n)[0] = $label AND n.名称 = $name RETURN n LIMIT 1`,
        { label, name },
      );
      if (exist.records.length === 0) {
        throw new BadRequestException(`节点不存在: ${label}/${name}`);
      }
      if (newName !== name) {
        const conflict = await session.run(
          `MATCH (n) WHERE labels(n)[0] = $label AND n.名称 = $newName RETURN n LIMIT 1`,
          { label, newName },
        );
        if (conflict.records.length > 0) {
          throw new BadRequestException(`目标名称已被占用: ${label}/${newName}`);
        }
      }
      const props = { ...properties, 名称: newName };
      await session.run(
        `MATCH (n) WHERE labels(n)[0] = $label AND n.名称 = $name SET n = $props`,
        { label, name, props },
      );
      return { name: newName, label, properties: props };
    } finally {
      await session.close();
    }
  }

  /** 删除节点（连带其所有关系） */
  async deleteNode(params: { label: string; name: string }): Promise<{ deleted: boolean }> {
    const { label, name } = params;
    const session = this.driver.session();
    try {
      const res = await session.run(
        `MATCH (n) WHERE labels(n)[0] = $label AND n.名称 = $name DETACH DELETE n RETURN count(n) AS c`,
        { label, name },
      );
      const c = Number(res.records[0]?.get('c') ?? 0);
      return { deleted: c > 0 };
    } finally {
      await session.close();
    }
  }

  /** 分页查询关系（支持按端点名称/关系类型过滤） */
  async listRelations(params: {
    kw?: string;
    page: number;
    pageSize: number;
  }): Promise<{
    list: { from: string; fromLabel: string; type: string; to: string; toLabel: string }[];
    total: number;
  }> {
    const { kw, page, pageSize } = params;
    const where = kw
      ? 'WHERE a.名称 CONTAINS $kw OR b.名称 CONTAINS $kw OR type(r) CONTAINS $kw'
      : '';

    const session = this.driver.session();
    try {
      const countRes = await session.run(`MATCH (a)-[r]->(b) ${where} RETURN count(r) AS total`, {
        kw,
      });
      const listRes = await session.run(
        `MATCH (a)-[r]->(b) ${where}
           RETURN a.名称 AS from, labels(a)[0] AS fromLabel, type(r) AS type,
                  b.名称 AS to, labels(b)[0] AS toLabel
           ORDER BY type(r)
           SKIP $skip LIMIT $limit`,
        { kw, skip: neo4j.int((page - 1) * pageSize), limit: neo4j.int(pageSize) },
      );
      const total = countRes.records[0]?.get('total') ?? 0;
      const list = listRes.records.map((r) => ({
        from: r.get('from') as string,
        fromLabel: r.get('fromLabel') as string,
        type: r.get('type') as string,
        to: r.get('to') as string,
        toLabel: r.get('toLabel') as string,
      }));
      return { list, total: Number(total) };
    } finally {
      await session.close();
    }
  }

  /** 创建关系（幂等 MERGE） */
  async createRelation(params: {
    type: string;
    fromLabel: string;
    fromName: string;
    toLabel: string;
    toName: string;
  }): Promise<{ created: boolean }> {
    const { type, fromLabel, fromName, toLabel, toName } = params;
    const session = this.driver.session();
    try {
      const fromRes = await session.run(
        `MATCH (n) WHERE labels(n)[0] = $label AND n.名称 = $name RETURN n LIMIT 1`,
        { label: fromLabel, name: fromName },
      );
      if (fromRes.records.length === 0) {
        throw new BadRequestException(`起点节点不存在: ${fromLabel}/${fromName}`);
      }
      const toRes = await session.run(
        `MATCH (n) WHERE labels(n)[0] = $label AND n.名称 = $name RETURN n LIMIT 1`,
        { label: toLabel, name: toName },
      );
      if (toRes.records.length === 0) {
        throw new BadRequestException(`终点节点不存在: ${toLabel}/${toName}`);
      }
      await session.run(
        `MATCH (a) WHERE labels(a)[0] = $fromLabel AND a.名称 = $fromName
         MATCH (b) WHERE labels(b)[0] = $toLabel AND b.名称 = $toName
         MERGE (a)-[:${type}]->(b)`,
        { fromLabel, fromName, toLabel, toName },
      );
      return { created: true };
    } finally {
      await session.close();
    }
  }

  /** 删除关系 */
  async deleteRelation(params: {
    type: string;
    fromLabel: string;
    fromName: string;
    toLabel: string;
    toName: string;
  }): Promise<{ deleted: boolean }> {
    const { type, fromLabel, fromName, toLabel, toName } = params;
    const session = this.driver.session();
    try {
      const res = await session.run(
        `MATCH (a)-[r:${type}]->(b)
         WHERE labels(a)[0] = $fromLabel AND a.名称 = $fromName
           AND labels(b)[0] = $toLabel AND b.名称 = $toName
         DELETE r RETURN count(r) AS c`,
        { fromLabel, fromName, toLabel, toName },
      );
      const c = Number(res.records[0]?.get('c') ?? 0);
      return { deleted: c > 0 };
    } finally {
      await session.close();
    }
  }
}