import {
  clarificationResponse,
  previousTopics,
  resolveFollowup,
} from './followup-context';
import type { QaResponse } from './qa-response';
import { answerSections } from './answer-sections';
import { collectEvidence } from './grounded-answer';

describe('bounded explicit conversation context', () => {
  it('inherits one disease only for a short follow-up', () => {
    expect(resolveFollowup('饮食呢？', [], '宜吃食物', ['高血压'])).toEqual({
      resolvedQuestion: '高血压：饮食呢？',
      inheritedEntities: ['高血压'],
      needsClarification: false,
    });
    expect(
      resolveFollowup('法国首都在哪里', [], null, ['高血压']).inheritedEntities,
    ).toEqual([]);
    expect(
      resolveFollowup('天气呢？', [], null, ['高血压']).inheritedEntities,
    ).toEqual([]);
    expect(
      resolveFollowup('法国首都是什么？', [], '简介', ['高血压'])
        .inheritedEntities,
    ).toEqual([]);
    expect(
      resolveFollowup('需要做哪些检查？', [], '检查', ['高血压']),
    ).toMatchObject({
      resolvedQuestion: '高血压：需要做哪些检查？',
      inheritedEntities: ['高血压'],
      needsClarification: false,
    });
    expect(
      resolveFollowup('剂量呢？', [], '用药剂量', ['高血压']),
    ).toMatchObject({
      resolvedQuestion: '高血压：剂量呢？',
      inheritedEntities: ['高血压'],
    });
  });

  it('an unrecognized new subject cannot silently inherit the previous disease', () => {
    const question = '未收录罕见病的症状有哪些？';
    expect(resolveFollowup(question, [], '症状', ['高血压'])).toEqual({
      resolvedQuestion: question,
      inheritedEntities: [],
      needsClarification: true,
    });
    expect(
      resolveFollowup('法国天气变化的原因是什么？', [], '病因', ['高血压']),
    ).toMatchObject({ inheritedEntities: [], needsClarification: true });
    expect(
      resolveFollowup('某新病怎么治疗？', [], '治疗方法', ['高血压']),
    ).toMatchObject({ inheritedEntities: [], needsClarification: true });
  });
  it('explicit new entities override the old subject', () => {
    expect(
      resolveFollowup(
        '糖尿病有什么症状',
        [{ name: '糖尿病', type: '疾病' }],
        '症状',
        ['高血压'],
      ).resolvedQuestion,
    ).toBe('糖尿病有什么症状');
    expect(
      resolveFollowup(
        '血常规检查是什么',
        [{ name: '血常规', type: '检查项目' }],
        '检查',
        ['高血压'],
      ).inheritedEntities,
    ).toEqual([]);
  });
  it('asks clarification rather than guessing among diseases or with missing context', () => {
    const resolution = resolveFollowup('检查呢？', [], '检查', [
      '高血压',
      '糖尿病',
    ]);
    expect(resolution.needsClarification).toBe(true);
    expect(clarificationResponse(resolution).sources).toEqual([]);
    expect(previousTopics(clarificationResponse(resolution))).toEqual([
      '高血压',
      '糖尿病',
    ]);
    expect(
      resolveFollowup('饮食呢？', [], '宜吃食物', []).needsClarification,
    ).toBe(true);
  });
  it('does not promote vector guesses or model prose into conversation subjects', () => {
    const snapshot = {
      entities: [{ name: '高血压', type: '疾病' }],
      answer: '糖尿病',
      vectorMatched: true,
    } as QaResponse;
    expect(previousTopics(snapshot)).toEqual([]);
    expect(previousTopics({ ...snapshot, vectorMatched: false })).toEqual([
      '高血压',
    ]);
    expect(previousTopics()).toEqual([]);
  });
  it('preserves unsupported intents for dose questions instead of inventing an answer', () => {
    expect(
      resolveFollowup('每天用量呢？', [], '用药剂量', ['高血压'])
        .resolvedQuestion,
    ).toBe('高血压：每天用量呢？');
  });
  it('structured items retain exact facts, directions, and every source ID', () => {
    const { sources } = collectEvidence([
      {
        entity: '高血压',
        relations: [
          { entity: '头痛', relation: '症状', label: '症状' },
          {
            entity: '糖尿病',
            relation: '并发症',
            label: '疾病',
            direction: 'incoming',
          },
        ],
      },
    ]);
    const items = answerSections(sources).flatMap((section) => section.items);
    expect(items.map((item) => item.text)).toEqual(
      sources.map((source) => source.text),
    );
    expect(items.flatMap((item) => item.sourceIds)).toEqual(
      sources.map((source) => source.id),
    );
  });
});
