import {
  collectEvidence,
  renderEvidence,
  validateFactOrder,
} from './grounded-answer';

describe('回答证据边界', () => {
  it('去重并明确标记被展示数量限制省略的事实', () => {
    const relations = Array.from({ length: 12 }, (_, index) => ({
      relation: '症状',
      entity: `症状${index}`,
      label: '疾病症状',
    }));
    const evidence = collectEvidence([
      { entity: '疾病', relations: [...relations, relations[0]] },
    ]);
    expect(evidence.sources).toHaveLength(10);
    expect(evidence.omitted).toBe(2);
    expect(renderEvidence(evidence.sources, evidence.omitted)).toContain(
      '另有至少 2 条记录未展示',
    );
  });

  it('保留多个实体的事实归属与关系方向', () => {
    const evidence = collectEvidence([
      {
        entity: '甲',
        relations: [
          { entity: '乙', relation: '使用药品', direction: 'incoming' },
        ],
      },
      { entity: '丙', relations: [{ entity: '乙', relation: '常用药品' }] },
    ]);
    expect(evidence.sources[0].text).toBe('乙 --使用药品--> 甲');
    expect(evidence.sources[1].subject).toBe('丙');
    expect(() =>
      validateFactOrder('{"factIds":["F1"]}', evidence.sources),
    ).toThrow('遗漏');
  });

  it('丢弃空属性，限制整体事实数量并拒绝超大模型响应', () => {
    const evidence = collectEvidence([
      {
        entity: '甲',
        relations: [
          { relation: '空', entity: ' ' },
          ...Array.from({ length: 50 }, (_, index) => ({
            relation: `关系${index}`,
            entity: `值${index}`,
          })),
        ],
      },
    ]);
    expect(evidence.sources).toHaveLength(40);
    expect(evidence.omitted).toBe(10);
    expect(() => validateFactOrder(' '.repeat(5000), evidence.sources)).toThrow(
      '无效',
    );
  });
});
