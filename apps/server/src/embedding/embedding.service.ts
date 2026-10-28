import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConsistencyLevelEnum,
  LoadState,
  MilvusClient,
} from '@zilliz/milvus2-sdk-node';

export interface VectorCandidate {
  name: string;
  type: string;
  desc?: string;
  score: number;
}

const EMBED_TIMEOUT_MS = 15_000;
const SEARCH_TIMEOUT_MS = 5_000;

/**
 * 向量检索服务（B 步骤 3-4 兜底链路）
 * - embed：本地 Ollama bge-m3 或阿里云 text-embedding-v4（按模型名自动切换）
 * - searchCandidates：问题 → embedding → Milvus Top-K 候选实体
 * - 全程降级：任一环节失败返回空数组/空向量，绝不抛错影响问答主链路
 */
@Injectable()
export class EmbeddingService implements OnModuleDestroy {
  private readonly logger = new Logger(EmbeddingService.name);
  private milvus: MilvusClient | null = null;
  /** 熔断：Milvus 失败后的冷却截止时间，期间直接返回 []，避免反复触发 gRPC 错误 */
  private milvusDownUntil = 0;
  private readonly COOL_DOWN_MS = 60_000;

  constructor(private readonly config: ConfigService) {}

  private get model(): string {
    return this.config.get<string>('embedding.model') ?? 'bge-m3';
  }

  private get baseUrl(): string {
    return (
      this.config.get<string>('embedding.baseUrl') ?? 'http://localhost:11434'
    );
  }

  private get dashscopeApiKey(): string | undefined {
    return this.config.get<string>('embedding.dashscopeApiKey');
  }

  private get collection(): string {
    return this.config.get<string>('embedding.collection') ?? 'entities';
  }

  private get milvusUri(): string {
    return this.config.get<string>('embedding.milvusUri') ?? 'localhost:19540';
  }

  private get threshold(): number {
    return this.config.get<number>('embedding.threshold') ?? 0.6;
  }

  private get topK(): number {
    return this.config.get<number>('embedding.topK') ?? 5;
  }

  private milvusClient(): MilvusClient {
    if (!this.milvus) {
      this.milvus = new MilvusClient({
        address: this.milvusUri,
        logLevel: 'error',
      });
    }
    return this.milvus;
  }

  async onModuleDestroy() {
    await this.milvus?.closeConnection();
  }

  async availability(): Promise<{ milvus: boolean; embedding: boolean }> {
    const milvus = (async () => {
      try {
        const state = await this.milvusClient().getLoadState({
          collection_name: this.collection,
          timeout: 3000,
        });
        return (
          state.status.error_code === 'Success' &&
          state.state === LoadState.LoadStateLoaded
        );
      } catch {
        return false;
      }
    })();
    const embedding = (async () => {
      try {
        if (this.model.startsWith('text-embedding'))
          return !!this.dashscopeApiKey;
        const response = await fetch(`${this.baseUrl}/api/tags`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) return false;
        const data = (await response.json()) as { models?: { name: string }[] };
        return !!data.models?.some(
          (model) =>
            model.name.replace(/:latest$/, '') ===
            this.model.replace(/:latest$/, ''),
        );
      } catch {
        return false;
      }
    })();
    const [milvusOk, embeddingOk] = await Promise.all([milvus, embedding]);
    return { milvus: milvusOk, embedding: embeddingOk };
  }

  /** 用已有主键标识待替换行；AutoID 集合的 upsert 会为替换行分配新主键。 */
  async syncEntity(name: string, type: string, desc?: string): Promise<void> {
    const vector = await this.embed(name + (desc ? `：${desc}` : ''));
    if (!vector?.length) throw new Error('实体向量生成失败');
    const client = this.milvusClient();
    const filter = `entity_name == ${JSON.stringify(name)} and entity_type == ${JSON.stringify(type)}`;
    const existing = await client.query({
      collection_name: this.collection,
      filter,
      output_fields: ['id'],
      limit: 100,
      consistency_level: ConsistencyLevelEnum.Strong,
      timeout: SEARCH_TIMEOUT_MS,
    });
    if (existing.status.error_code !== 'Success')
      throw new Error('已有向量查询失败');
    const row = {
      entity_name: name,
      entity_type: type,
      entity_desc: desc ?? '',
      embedding: vector,
    };
    const id = existing.data[0]?.id as string | undefined;
    const result =
      id === undefined
        ? await client.insert({
            collection_name: this.collection,
            data: [row],
            timeout: SEARCH_TIMEOUT_MS,
          })
        : await client.upsert({
            collection_name: this.collection,
            data: [{ ...row, id }],
            timeout: SEARCH_TIMEOUT_MS,
          });
    if (result.status.error_code !== 'Success')
      throw new Error('实体向量更新失败');
  }

  async removeEntity(name: string, type: string): Promise<void> {
    const result = await this.milvusClient().deleteEntities({
      collection_name: this.collection,
      expr: `entity_name == ${JSON.stringify(name)} and entity_type == ${JSON.stringify(type)}`,
      timeout: SEARCH_TIMEOUT_MS,
    });
    if (result.status.error_code !== 'Success')
      throw new Error('实体向量删除失败');
  }

  /** 文本 → 向量。失败返回 null（不抛错） */
  async embed(text: string): Promise<number[] | null> {
    try {
      if (this.model.startsWith('text-embedding')) {
        return await this.embedDashscope(text);
      }
      return await this.embedOllama(text);
    } catch (err) {
      this.logger.warn(`embedding 调用失败: ${(err as Error).message}`);
      return null;
    }
  }

  private async embedOllama(text: string): Promise<number[]> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), EMBED_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          input: [text],
          keep_alive: '30m',
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(
          `Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`,
        );
      }
      const j = (await res.json()) as { embeddings: number[][] };
      return j.embeddings?.[0] ?? [];
    } finally {
      clearTimeout(timer);
    }
  }

  private async embedDashscope(text: string): Promise<number[]> {
    if (!this.dashscopeApiKey) {
      throw new Error('text-embedding 模型需要 DASHSCOPE_API_KEY');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), EMBED_TIMEOUT_MS);
    try {
      const res = await fetch(
        'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.dashscopeApiKey}`,
          },
          body: JSON.stringify({ model: this.model, input: text }),
          signal: ctrl.signal,
        },
      );
      if (!res.ok) {
        throw new Error(
          `DashScope ${res.status}: ${(await res.text()).slice(0, 200)}`,
        );
      }
      const j = (await res.json()) as {
        output: { embeddings: { embedding: number[] }[] };
      };
      return j.output?.embeddings?.[0]?.embedding ?? [];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 问题 → 向量检索候选实体（按相似度降序）。
   * 全程降级：失败返回 []，不抛错。
   */
  async searchCandidates(question: string): Promise<VectorCandidate[]> {
    try {
      if (Date.now() < this.milvusDownUntil) return [];
      const vector = await this.embed(question);
      if (!vector || vector.length === 0) return [];

      // 熔断：Milvus 冷却期内直接跳过，防止 gRPC 内部 rejection 打崩进程
      if (Date.now() < this.milvusDownUntil) return [];

      try {
        const res = await this.milvusClient().search({
          collection_name: this.collection,
          vector,
          output_fields: ['entity_name', 'entity_type', 'entity_desc'],
          limit: this.topK,
          metric_type: 'COSINE',
          timeout: SEARCH_TIMEOUT_MS,
        });
        const results = (res.results ?? []).filter(
          (r) => r.entity_name && r.score >= this.threshold,
        );
        if (results.length === 0) {
          this.logger.log(
            `向量检索无候选（阈值 ${this.threshold}），问题: ${question.slice(0, 30)}`,
          );
        }
        return results.map((r) => ({
          name: r.entity_name as string,
          type: (r.entity_type as string) ?? 'unknown',
          desc: r.entity_desc as string | undefined,
          score: r.score,
        }));
      } catch (err) {
        this.milvusDownUntil = Date.now() + this.COOL_DOWN_MS;
        this.logger.warn(
          `向量检索失败，冷却 ${this.COOL_DOWN_MS / 1000}s 后重试: ${(err as Error).message}`,
        );
        return [];
      }
    } catch (err) {
      this.logger.warn(`向量检索失败，跳过兜底: ${(err as Error).message}`);
      return [];
    }
  }

  /** 健康检查：embedding + Milvus 链路可用性（供监控/调试） */
  async ping(): Promise<{
    embedOk: boolean;
    milvusOk: boolean;
    model: string;
  }> {
    const vector = await this.embed('测试');
    let milvusOk = false;
    try {
      const c = this.milvusClient();
      const res = await c.hasCollection({
        collection_name: this.collection,
        timeout: SEARCH_TIMEOUT_MS,
      });
      milvusOk = !!res.value;
    } catch {
      milvusOk = false;
    }
    return {
      embedOk: !!vector && vector.length > 0,
      milvusOk,
      model: this.model,
    };
  }
}
