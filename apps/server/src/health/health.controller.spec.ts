import { HealthController } from './health.controller';
import {
  HealthCheckService,
  TerminusModule,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import type { Driver } from 'neo4j-driver';
import { EmbeddingService } from '../embedding/embedding.service';
import { LlmGateway } from '../llm/llm.gateway';
jest.mock('@zilliz/milvus2-sdk-node', () => ({
  ConsistencyLevelEnum: { Strong: 0 },
  MilvusClient: jest.fn(),
}));
describe('存活、就绪与降级状态', () => {
  const core = {
    check: jest.fn(() =>
      Promise.resolve({ status: 'ok', details: { neo4j: { status: 'up' } } }),
    ),
  };
  const embedding = {
    availability: jest.fn(() =>
      Promise.resolve({ milvus: false, embedding: true }),
    ),
  };
  const llm = { health: jest.fn(() => Promise.resolve(true)) };
  const controller = new HealthController(
    core as unknown as HealthCheckService,
    {} as TypeOrmHealthIndicator,
    {} as Redis,
    {} as Driver,
    embedding as unknown as EmbeddingService,
    llm as unknown as LlmGateway,
  );
  beforeEach(() => jest.clearAllMocks());
  it('存活检查不调用外部服务', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
    expect(core.check).not.toHaveBeenCalled();
  });
  it('可选向量故障明确报告降级，核心就绪仍允许服务', async () => {
    const result = await controller.check();
    expect(result.status).toBe('degraded');
    expect(result.details.milvus).toEqual({ status: 'down', required: false });
    expect(core.check).toHaveBeenCalled();
  });
});

describe('真实 Terminus 就绪失败响应', () => {
  it.each(['redis', 'neo4j'])(
    '%s 故障时返回 503，存活检查仍成功',
    async (failed) => {
      const module = await Test.createTestingModule({
        imports: [TerminusModule],
      }).compile();
      const controller = new HealthController(
        module.get(HealthCheckService),
        {
          pingCheck: () => Promise.resolve({ mongodb: { status: 'up' } }),
        } as unknown as TypeOrmHealthIndicator,
        {
          ping: () =>
            failed === 'redis'
              ? Promise.reject(new Error('fixture outage'))
              : Promise.resolve('PONG'),
        } as unknown as Redis,
        {
          verifyConnectivity: () =>
            failed === 'neo4j'
              ? Promise.reject(new Error('fixture outage'))
              : Promise.resolve(),
        } as unknown as Driver,
        {} as EmbeddingService,
        {} as LlmGateway,
      );
      try {
        await expect(controller.ready()).rejects.toMatchObject({ status: 503 });
        expect(controller.live()).toEqual({ status: 'ok' });
      } finally {
        await module.close();
      }
    },
  );
});
