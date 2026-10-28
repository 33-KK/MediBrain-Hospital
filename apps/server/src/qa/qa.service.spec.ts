import { ConfigService } from '@nestjs/config';
import { QaService } from './qa.service';
import { GraphRelation, GraphService } from '../neo4j/graph.service';
import { EntityRecognitionService } from '../entity/entity-recognition.service';
import { LlmGateway } from '../llm/llm.gateway';
import { EmbeddingService } from '../embedding/embedding.service';
import { withinDeadline } from '../common/within-deadline';
import { KnowledgeService } from '../knowledge/knowledge.service';

// Unit tests exercise service behavior without loading native/ESM transport dependencies.
jest.mock('@zilliz/milvus2-sdk-node', () => ({
  ConsistencyLevelEnum: { Strong: 0 },
  MilvusClient: jest.fn(),
}));

describe('医学检索和故障降级', () => {
  const facts: GraphRelation[] = [
    { relation: '宜吃食物', entity: '允许食物测试项', label: '食物' },
    { relation: '忌吃食物', entity: '禁忌食物测试项', label: '食物' },
  ];
  const graph = {
    loadEntityDictionary: jest.fn(() =>
      Promise.resolve(
        new Map([
          ['测试疾病', '疾病'],
          ['测试药品', '药品'],
        ]),
      ),
    ),
    getDiseaseInfo: jest.fn(() =>
      Promise.resolve({
        disease: {
          name: '测试疾病',
          label: '疾病',
          attributes: { 病因: '病因测试属性' },
        },
        relations: facts,
      }),
    ),
    getEntityNeighbors: jest.fn(() =>
      Promise.resolve({
        node: {},
        neighbors: [
          { relation: '关联疾病', entity: '测试疾病', label: '疾病' },
        ] as GraphRelation[],
      }),
    ),
  };
  const llm = {
    providerName: 'mock',
    chat: jest.fn((): Promise<string> => Promise.reject(new Error('模型故障'))),
  };
  const embedding = { searchCandidates: jest.fn(() => Promise.resolve([])) };
  const knowledge = {
    related: jest.fn((): Promise<unknown[]> => Promise.resolve([])),
    search: jest.fn(),
  };
  let entity: EntityRecognitionService;
  let qa: QaService;

  beforeEach(async () => {
    jest.clearAllMocks();
    entity = new EntityRecognitionService(graph as unknown as GraphService);
    await entity.reloadDictionary();
    qa = new QaService(
      graph as unknown as GraphService,
      entity,
      llm as unknown as LlmGateway,
      embedding as unknown as EmbeddingService,
      knowledge as unknown as KnowledgeService,
    );
  });

  it.each([
    '测试疾病不能吃什么',
    '测试疾病不宜吃什么',
    '测试疾病饮食有什么忌口',
  ])('否定饮食只使用禁忌事实：%s', async (question) => {
    const result = await qa.ask(question);
    expect(result.dimension).toBe('忌吃食物');
    expect(result.answer).toContain('禁忌食物测试项');
    expect(result.answer).not.toContain('允许食物测试项');
    expect(result.provider).toBe('graph');
  });

  it('肯定饮食使用推荐事实', async () => {
    const result = await qa.ask('测试疾病可以吃什么');
    expect(result.answer).toContain('允许食物测试项');
    expect(result.answer).not.toContain('禁忌食物测试项');
  });

  it('资料查询只列出来源，不把草稿作为医学事实或交给模型生成', async () => {
    knowledge.related.mockResolvedValueOnce([
      {
        id: 'reference-1',
        title: '测试疾病指南',
        publisher: '来源机构',
        version: '2026',
        reviewStatus: 'pending',
      },
    ]);
    const result = await qa.ask('测试疾病有哪些参考资料');
    expect(result.references).toHaveLength(1);
    expect(result.sources).toEqual([]);
    expect(result.grounding.mode).toBe('reference-library');
    expect(result.answer).toContain('测试疾病指南');
    expect(llm.chat).not.toHaveBeenCalled();
    expect(graph.getDiseaseInfo).not.toHaveBeenCalled();
  });

  it('资料库故障不会影响原有医学事实回答', async () => {
    knowledge.related.mockRejectedValueOnce(new Error('资料索引不可用'));
    const result = await qa.ask('测试疾病可以吃什么');
    expect(result.answer).toContain('允许食物测试项');
    expect(result.references).toEqual([]);
  });

  it('病因回答使用节点属性', async () => {
    const result = await qa.ask('测试疾病的病因');
    expect(result.answer).toContain('病因测试属性');
    expect(result.answer).not.toContain('食物测试项');
  });

  it('没有禁忌用药事实时不返回常用药或食物作为替代', async () => {
    const result = await qa.ask('测试疾病不能吃什么药');
    expect(result.dimension).toBe('禁忌药品');
    expect(result.graphMatched).toBe(false);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it.each(['测试药品每天吃几片，剂量是多少', '测试药品能和其他药一起服用吗'])(
    '未收录的用药维度不返回邻居替代：%s',
    async (question) => {
      const result = await qa.ask(question);
      expect(result.graphMatched).toBe(false);
      expect(result.sources).toEqual([]);
      expect(llm.chat).not.toHaveBeenCalled();
    },
  );

  it('药品直接查询邻居，不依赖向量检索', async () => {
    const result = await qa.ask('测试药品相关信息');
    expect(graph.getEntityNeighbors).toHaveBeenCalledWith('测试药品');
    expect(embedding.searchCandidates).not.toHaveBeenCalled();
    expect(result.graphMatched).toBe(true);
  });

  it('药品入边保留疾病到药品的方向', async () => {
    graph.getEntityNeighbors.mockResolvedValueOnce({
      node: {},
      neighbors: [
        {
          relation: '疾病使用药品',
          entity: '测试疾病',
          label: '疾病',
          direction: 'incoming',
        },
      ],
    });
    const result = await qa.ask('测试药品相关信息');
    expect(result.answer).toContain('测试疾病 --疾病使用药品--> 测试药品');
  });

  it('没有图谱事实时不调用模型生成答案', async () => {
    const result = await qa.ask('完全未知的问题');
    expect(result.graphMatched).toBe(false);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('Neo4j 故障返回服务状态', async () => {
    graph.getDiseaseInfo.mockRejectedValueOnce(new Error('连接失败'));
    const result = await qa.ask('测试疾病的症状');
    expect(result.knowledgeUnavailable).toBe(true);
    expect(result.answer).toContain('暂时不可用');
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('同名记录冲突返回待复核状态，不伪装成连接故障或调用模型', async () => {
    const conflicting = Object.assign(await graph.getDiseaseInfo(), {
      reviewRequired: true,
    });
    graph.getDiseaseInfo.mockResolvedValueOnce(conflicting);
    const result = await qa.ask('测试疾病的病因');
    expect(result.reviewEntities).toEqual(['测试疾病']);
    expect(result.knowledgeUnavailable).toBe(false);
    expect(result.sources).toEqual([]);
    expect(result.answer).toContain('待专业复核');
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it.each([
    '禁忌食物测试项含盐量较高，所以不能吃。',
    '{"factIds":["F1"],"answer":"新增医学解释"}',
    '{"factIds":["F999"]}',
    '{"factIds":[]}',
    '{"factIds":["F1","F1"]}',
    '```json\n{"factIds":["F1"]}\n```',
  ])('拒绝自由解释、注入或无效编号：%s', async (response) => {
    llm.chat.mockResolvedValueOnce(response);
    const result = await qa.ask('测试疾病不能吃什么');
    expect(result.provider).toBe('graph');
    expect(result.grounding.modelAccepted).toBe(false);
    expect(result.answer).toContain('禁忌食物测试项 [F1]');
    expect(result.answer).not.toContain('含盐');
    expect(result.answer).not.toContain('新增医学');
    expect(result.sources[0].subject).toBe('测试疾病');
  });

  it('接受完整编号排列，但回答文字始终由图谱构造', async () => {
    llm.chat.mockResolvedValueOnce('{"factIds":["F2","F1","F3"]}');
    const result = await qa.ask('测试疾病相关信息');
    expect(result.provider).toBe('mock');
    expect(result.grounding.modelAccepted).toBe(true);
    expect(result.sources.map((source) => source.id)).toEqual([
      'F2',
      'F1',
      'F3',
    ]);
    for (const source of result.sources)
      expect(result.answer).toContain(`${source.text} [${source.id}]`);
  });

  it('即使模型忽略请求超时，也在 5 秒后返回有依据的记录', async () => {
    jest.useFakeTimers();
    try {
      llm.chat.mockImplementationOnce(
        () => new Promise<string>(() => undefined),
      );
      const pending = qa.ask('测试疾病不能吃什么');
      await jest.advanceTimersByTimeAsync(5005);
      const result = await pending;
      expect(result.provider).toBe('graph');
      expect(result.answer).toContain('禁忌食物测试项 [F1]');
    } finally {
      jest.useRealTimers();
    }
  });

  it('另一副本的图谱变更会刷新实体词典', async () => {
    graph.loadEntityDictionary.mockResolvedValueOnce(
      new Map([['新实体', '疾病']]),
    );
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);
    try {
      await entity.ensureFresh();
      expect(entity.recognize('新实体的症状')[0].name).toBe('新实体');
      expect(entity.recognize('测试疾病的症状')).toEqual([]);
    } finally {
      jest.restoreAllMocks();
    }
  });
});

describe('请求期限', () => {
  it('到期后停止等待上游，并拒绝启动后续请求', async () => {
    await expect(
      withinDeadline(() => new Promise(() => undefined), Date.now() + 10),
    ).rejects.toThrow('超时');
    const operation = jest.fn(() => Promise.resolve(true));
    await expect(withinDeadline(operation, Date.now() - 1)).rejects.toThrow(
      '超时',
    );
    expect(operation).not.toHaveBeenCalled();
  });
});

describe('向量索引维护', () => {
  it('更新已有实体使用原主键，不新增重复实体', async () => {
    const service = new EmbeddingService(new ConfigService());
    const client = {
      query: jest.fn(() =>
        Promise.resolve({
          status: { error_code: 'Success' },
          data: [{ id: '123' }],
        }),
      ),
      upsert: jest.fn(() =>
        Promise.resolve({ status: { error_code: 'Success' } }),
      ),
      insert: jest.fn(),
    };
    Object.assign(service, { milvus: client });
    jest.spyOn(service, 'embed').mockResolvedValue([1, 0]);
    await service.syncEntity('测试药品', '药品', '更新描述');
    expect(client.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ id: '123', entity_desc: '更新描述' })],
      }),
    );
    expect(client.insert).not.toHaveBeenCalled();
  });
});
