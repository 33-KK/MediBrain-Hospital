import type { Driver } from 'neo4j-driver';
import { GraphService } from './graph.service';

describe('只读图谱的冲突记录保护', () => {
  const run = jest.fn();
  const close = jest.fn(() => Promise.resolve());
  const driver = { session: () => ({ run, close }) } as unknown as Driver;
  beforeEach(() => jest.clearAllMocks());

  it('疾病详情不任意选择冲突版本', async () => {
    run.mockResolvedValueOnce({ records: [{}, {}] });
    const result = await new GraphService(driver).getDiseaseInfo('同名');
    expect(result.disease).toBeNull();
    expect(result.relations).toEqual([]);
    expect(result.reviewRequired).toBe(true);
    expect(result.reviewReason).toContain('冲突');
  });

  it.each([
    ['疾病', '疾病症状'],
    ['疾病症状', '疾病'],
  ])('疾病与症状同名时优先疾病，加载顺序为 %s / %s', async (...labels) => {
    run.mockResolvedValueOnce({
      records: labels.map((label) => ({
        get: (key: string) => (key === 'name' ? '同名' : label),
      })),
    });
    const dictionary = await new GraphService(driver).loadEntityDictionary();
    expect(dictionary.get('同名')).toBe('疾病');
  });
});
