import { NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import neo4j, { type Driver } from 'neo4j-driver';
import {
  DOCUMENT_QA_LIMITS,
  KnowledgeService,
  splitDocumentPassages,
} from './knowledge.service';

describe('参考资料检索', () => {
  const executeQuery = jest.fn<
    Promise<{ records: { get: (key: string) => unknown }[] }>,
    [string, Record<string, unknown>, unknown?]
  >();
  const service = new KnowledgeService({ executeQuery } as unknown as Driver);
  const document = {
    id: 'source-1',
    title: '食养指南',
    kind: 'dietary-pdf',
    language: 'zh',
    publisher: '国家卫生健康委',
    url: 'https://www.nhc.gov.cn/example.pdf',
    version: '2026',
    topicsZh: ['脑卒中'],
    pageCount: neo4j.int(2),
    reviewStatus: 'pending',
  };
  const row = (values: Record<string, unknown>) => ({
    get: (key: string): unknown => values[key] ?? null,
  });

  beforeEach(() => jest.resetAllMocks());

  it('按文字检索，不允许用户关键词扩展 Lucene 运算符', async () => {
    executeQuery
      .mockResolvedValueOnce({ records: [row({ total: neo4j.int(1) })] })
      .mockResolvedValueOnce({ records: [row({ document })] });
    const result = await service.search('Asthma OR "diabetes"', 2, 20);
    expect(executeQuery.mock.calls[0][1]).toMatchObject({
      fulltext: '"Asthma" AND "OR" AND "\\"diabetes\\""',
      skip: neo4j.int(20),
      limit: neo4j.int(20),
    });
    expect(result.total).toBe(1);
    expect(result.list[0]).toMatchObject({
      pageCount: 2,
      reviewStatus: 'pending',
    });
  });

  it('读取指定 PDF 页，保留原文和待复核状态', async () => {
    executeQuery.mockResolvedValue({
      records: [
        row({
          document,
          pageText: '仅适用于原文指定的人群和阶段。',
          contentText: '不应返回整本正文',
          textKind: 'original-page-text',
          extractionStatus: 'text-extracted',
        }),
      ],
    });
    expect(await service.document('source-1', 2)).toMatchObject({
      contentText: '仅适用于原文指定的人群和阶段。',
      page: 2,
      reviewStatus: 'pending',
      extractionStatus: 'text-extracted',
      paragraphs: splitDocumentPassages('仅适用于原文指定的人群和阶段。'),
    });
    expect(executeQuery.mock.calls[0][1]).toMatchObject({
      id: 'source-1',
      page: neo4j.int(2),
    });
  });

  it('无此资料或超出 PDF 页码时返回 404', async () => {
    executeQuery.mockResolvedValueOnce({ records: [] });
    await expect(service.document('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    executeQuery.mockResolvedValueOnce({ records: [row({ document })] });
    await expect(service.document('source-1', 3)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('没有识别到疾病时，不把其他资料当作相关来源', async () => {
    expect(await service.related([])).toEqual([]);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('文档问答只读取选定资料原页，摘要草稿不混入页文本，并限制查询时间', async () => {
    executeQuery
      .mockResolvedValueOnce({
        records: [
          row({
            document,
            originalSha256: 'a'.repeat(64),
            textKind: 'adapted-draft',
            textLength: neo4j.int(100),
            contentText: '不可作原文的草稿',
          }),
        ],
      })
      .mockResolvedValueOnce({
        records: [
          row({
            pageNumber: neo4j.int(1),
            textLength: neo4j.int(12),
            pageText: '实际PDF原文第一页文字',
            extractionStatus: 'text-extracted',
          }),
          row({
            pageNumber: neo4j.int(2),
            textLength: neo4j.int(0),
            pageText: '',
            extractionStatus: 'no-text-layer',
          }),
        ],
      });
    expect(await service.qaDocument('source-1')).toMatchObject({
      textKind: 'original-page-text',
      incomplete: true,
      pages: [
        { page: 1, text: '实际PDF原文第一页文字' },
        { page: 2, text: '' },
      ],
    });
    for (const [query, params, config] of executeQuery.mock.calls) {
      expect(query).not.toMatch(/\b(?:CREATE|MERGE|SET|DELETE)\b/i);
      expect(params).toMatchObject({
        id: 'source-1',
        collection: 'official-medical-2026-10',
      });
      expect(config).toMatchObject({ routing: neo4j.routing.READ });
    }
    const configuration = executeQuery.mock.calls[0][2] as {
      transactionConfig: { timeout: number };
    };
    expect(configuration.transactionConfig.timeout).toBeLessThanOrEqual(
      DOCUMENT_QA_LIMITS.readTimeoutMs,
    );
    expect(executeQuery.mock.calls[1][1].maximumPages).toEqual(
      neo4j.int(DOCUMENT_QA_LIMITS.pages + 1),
    );
  });

  it('英文原文摘要没有伪造PDF页号，中文释义草稿被排除', async () => {
    executeQuery.mockResolvedValueOnce({
      records: [
        row({
          document: { ...document, pageCount: neo4j.int(0), language: 'en' },
          originalSha256: 'a'.repeat(64),
          contentText: 'Original English source summary.',
          textLength: neo4j.int(32),
          textKind: 'original-summary',
        }),
      ],
    });
    expect(await service.qaDocument('source-1')).toMatchObject({
      pages: [{ page: null, text: 'Original English source summary.' }],
    });
    executeQuery.mockResolvedValueOnce({
      records: [
        row({
          document: { ...document, pageCount: neo4j.int(0) },
          textKind: 'adapted-draft',
          contentText: '待审核译文',
          textLength: neo4j.int(5),
        }),
      ],
    });
    expect((await service.qaDocument('source-1')).pages).toEqual([]);
  });

  it('超限正文和页数不进入检索；重复页号也不会产生错误定位', async () => {
    executeQuery.mockResolvedValueOnce({
      records: [
        row({
          document: {
            ...document,
            pageCount: neo4j.int(DOCUMENT_QA_LIMITS.pages + 1),
          },
        }),
      ],
    });
    await expect(service.qaDocument('source-1')).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
    executeQuery.mockResolvedValueOnce({
      records: [
        row({
          document: { ...document, pageCount: neo4j.int(0) },
          textLength: neo4j.int(DOCUMENT_QA_LIMITS.totalCharacters + 1),
        }),
      ],
    });
    await expect(service.qaDocument('source-1')).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
    const duplicate = row({
      pageNumber: neo4j.int(1),
      textLength: neo4j.int(0),
      pageText: '',
    });
    executeQuery
      .mockResolvedValueOnce({ records: [row({ document })] })
      .mockResolvedValueOnce({ records: [duplicate, duplicate] });
    await expect(service.qaDocument('source-1')).rejects.toThrow(
      '页码元数据不一致',
    );
  });
});
