import { Controller, Get, Inject } from '@nestjs/common';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import Redis from 'ioredis';
import type { Driver } from 'neo4j-driver';
import { REDIS_CLIENT } from '../database/redis.module';
import { NEO4J_DRIVER } from '../neo4j/neo4j.constants';
import { EmbeddingService } from '../embedding/embedding.service';
import { LlmGateway } from '../llm/llm.gateway';
import { withinDeadline } from '../common/within-deadline';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(NEO4J_DRIVER) private readonly neo4j: Driver,
    private readonly embedding: EmbeddingService,
    private readonly llm: LlmGateway,
  ) {}
  @Get('live') live() {
    return { status: 'ok' };
  }
  @Get('ready') ready() {
    return this.health.check([
      () => this.db.pingCheck('mongodb', { timeout: 3000 }),
      async () => ({
        redis: {
          status: (await this.available(() =>
            this.redis.ping().then((pong) => pong === 'PONG'),
          ))
            ? 'up'
            : 'down',
        },
      }),
      async () => ({
        neo4j: {
          status: (await this.available(() =>
            this.neo4j.verifyConnectivity().then(() => true),
          ))
            ? 'up'
            : 'down',
        },
      }),
    ]);
  }
  @Get() async check() {
    const [core, vectors, model] = await Promise.all([
      this.ready(),
      this.embedding.availability(),
      this.available(() => this.llm.health()),
    ]);
    const optional = {
      milvus: { status: vectors.milvus ? 'up' : 'down', required: false },
      embedding: { status: vectors.embedding ? 'up' : 'down', required: false },
      llm: { status: model ? 'up' : 'down', required: false },
    };
    return {
      ...core,
      status: vectors.milvus && vectors.embedding && model ? 'ok' : 'degraded',
      details: { ...core.details, ...optional },
    };
  }
  private async available(operation: () => Promise<boolean>) {
    try {
      return await withinDeadline(operation, Date.now() + 3500);
    } catch {
      return false;
    }
  }
}
