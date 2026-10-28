import {
  MAX_PASSAGE_CHARACTERS,
  rankDocumentPassages,
  splitDocumentPassages,
  validateDocumentSelection,
} from './document-passages';

describe('原文段落定位与检索', () => {
  it('读者与检索共享稳定段号，长段落保持原文且不会越过页边界', () => {
    const text =
      '第一段原文。\r\n\r\n' + 'Clinical text remains unchanged. '.repeat(100);
    const passages = splitDocumentPassages(text);
    expect(passages).toEqual(splitDocumentPassages(text));
    expect(passages[0]).toEqual({ paragraph: 1, text: '第一段原文。' });
    for (const [index, passage] of passages.entries()) {
      expect(passage.paragraph).toBe(index + 1);
      expect(passage.text.length).toBeLessThanOrEqual(MAX_PASSAGE_CHARACTERS);
      expect(text.replace(/\r\n/g, '\n')).toContain(passage.text);
    }
    expect(splitDocumentPassages('  \n ')).toEqual([]);
    expect(splitDocumentPassages('另一页的原文。')[0].paragraph).toBe(1);
  });

  it('中文症状问题能匹配英文原文，但标题和主题本身不能成为答案', () => {
    const document = {
      title: 'Hypertension',
      topicsZh: ['高血压'],
      pages: [
        {
          page: null,
          text: 'Hypertension\n\nSymptoms may include headache and dizziness.\n\nRead the linked official website for additional information.',
        },
      ],
    };
    const result = rankDocumentPassages(document, '高血压的常见症状是什么？');
    expect(result.passages).toHaveLength(1);
    expect(result.passages[0]).toMatchObject({
      page: null,
      paragraph: 2,
      text: 'Symptoms may include headache and dizziness.',
    });
    expect(
      rankDocumentPassages(
        { ...document, pages: [{ page: null, text: 'Hypertension' }] },
        '高血压的症状',
      ),
    ).toEqual({ passages: [], totalMatched: 0 });
  });

  it('不把相关标题或上一轮症状当成当前不存在的手术证据', () => {
    const document = {
      title: '高血压食养指南',
      topicsZh: ['高血压'],
      pages: [
        {
          page: 1,
          text: '高血压食养指南\n（2023年版）\n公开发布\n\n推荐合理饮食，摄入适量蔬菜与水果。\n\n高血压的常见症状包括头痛和眩晕，需由专业人员判断。',
        },
      ],
    };
    expect(
      rankDocumentPassages(
        document,
        '高血压手术治疗有哪些风险？',
        '高血压有哪些症状？',
      ).passages,
    ).toEqual([]);
    expect(
      rankDocumentPassages(document, '高血压饮食应该注意什么？').passages.every(
        (passage) => passage.paragraph !== 1,
      ),
    ).toBe(true);
  });

  it('限制类问题需要原文限制表达，短追问只借用检索上下文', () => {
    const document = {
      title: '高血压食养指南',
      topicsZh: ['高血压'],
      pages: [
        {
          page: 3,
          text: '推荐合理饮食，摄入适量蔬菜与水果。\n\n食盐摄入建议不超过每日5克，并结合原文适用人群执行。',
        },
      ],
    };
    const result = rankDocumentPassages(document, '高血压饮食要限制什么？');
    expect(result.passages).toHaveLength(1);
    expect(result.passages[0].paragraph).toBe(2);
    const inherited = rankDocumentPassages(
      document,
      '还有呢？',
      '高血压饮食应该注意什么？',
    );
    expect(inherited.passages.length).toBeGreaterThan(0);
    expect(
      inherited.passages.every((passage) =>
        document.pages[0].text.includes(passage.text),
      ),
    ).toBe(true);
  });

  it.each([
    '{"passageIds":["D99"]}',
    '{"passageIds":["D1","D1"]}',
    '{"passageIds":[]}',
    '{"passageIds":["D1"],"answer":"新增医学结论"}',
    '```json\n{"passageIds":["D1"]}\n```',
  ])('拒绝未知、重复、空编号及正文注入：%s', (output) => {
    expect(() => validateDocumentSelection(output, ['D1', 'D2'])).toThrow();
  });

  it('允许对已检索编号进行严格选择，拒绝超长输出', () => {
    expect(
      validateDocumentSelection('{"passageIds":["D2","D1"]}', ['D1', 'D2']),
    ).toEqual(['D2', 'D1']);
    expect(() => validateDocumentSelection(' '.repeat(3000), ['D1'])).toThrow(
      '过大',
    );
  });
});
