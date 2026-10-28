import { MongoRepository } from 'typeorm';
import { ObjectId } from 'mongodb';
import { ConversationsService } from './conversations.service';
import { Conversation } from './entities/conversation.entity';
import {
  HistoryService,
  type SaveRecordInput,
} from '../history/history.service';
import type { QaRecord } from '../history/entities/qa-record.entity';
import { AccountOperationLockService } from './account-operation-lock.service';
import type { QaResponse } from '../qa/qa-response';

describe('saved conversations', () => {
  const user = { userId: new ObjectId().toHexString(), username: 'fixture' };
  const id = new ObjectId();
  const conversation = {
    _id: id,
    userId: user.userId,
    title: '测试',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const repo = {
    findOneBy: jest.fn<Promise<Conversation | null>, unknown[]>(),
    findAndCount: jest.fn(),
    create: jest.fn((value: Conversation) => value),
    save: jest.fn<Promise<Conversation>, [Conversation]>(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
  };
  const history = {
    conversationRecords: jest.fn<Promise<QaRecord[]>, [string, string]>(),
    conversationCount: jest.fn(),
    save: jest.fn<Promise<QaRecord>, [SaveRecordInput]>(),
  };
  const assertHeld = jest.fn().mockResolvedValue(undefined);
  const locks = {
    run: jest.fn(
      (_id, action: (check: () => Promise<void>) => Promise<unknown>) =>
        action(assertHeld),
    ),
  };
  const service = new ConversationsService(
    repo as unknown as MongoRepository<Conversation>,
    history as unknown as HistoryService,
    locks as unknown as AccountOperationLockService,
  );
  const result: QaResponse = {
    answer: '原文事实',
    entities: [],
    dimension: null,
    sources: [],
    provider: 'graph',
    graphMatched: false,
    grounding: { mode: 'graph-facts', modelAccepted: false, omitted: 0 },
  };
  beforeEach(() => {
    jest.clearAllMocks();
    repo.findOneBy.mockResolvedValue(conversation);
    repo.save.mockImplementation((value) => Promise.resolve(value));
    history.conversationRecords.mockResolvedValue([]);
    history.conversationCount.mockResolvedValue(0);
    history.save.mockImplementation((input) =>
      Promise.resolve({
        ...input,
        snapshot: { ...input.snapshot!, recordId: 'saved-id' },
      } as QaRecord),
    );
  });
  it('rejects a foreign or missing ID before generating or saving any answer', async () => {
    repo.findOneBy.mockResolvedValue(null);
    const answer = jest.fn();
    await expect(
      service.runTurn(
        user,
        { question: '测试问题', conversationId: id.toHexString() },
        answer,
      ),
    ).rejects.toThrow('会话不存在');
    expect(repo.findOneBy).toHaveBeenCalledWith({
      _id: id,
      userId: user.userId,
    });
    expect(answer).not.toHaveBeenCalled();
    expect(locks.run).not.toHaveBeenCalled();
  });
  it('persists the exact response snapshot and separate original/resolved questions', async () => {
    const output = await service.runTurn(
      user,
      { question: '饮食呢？', conversationId: id.toHexString() },
      () =>
        Promise.resolve({ ...result, resolvedQuestion: '高血压：饮食呢？' }),
    );
    expect(assertHeld).toHaveBeenCalled();
    const saved = history.save.mock.calls[0][0];
    expect(saved.userId).toBe(user.userId);
    expect(saved.question).toBe('饮食呢？');
    expect(saved.resolvedQuestion).toBe('高血压：饮食呢？');
    expect(saved.snapshot).toEqual({
      ...result,
      resolvedQuestion: '高血压：饮食呢？',
      conversationId: id.toHexString(),
      context: { inheritedEntities: [], needsClarification: false },
      documentEvidence: [],
      sections: [],
    });
    expect(output.recordId).toBe('saved-id');
    expect(output.conversationId).toBe(id.toHexString());
  });
  it('a document is fixed for the lifetime of a conversation', async () => {
    repo.findOneBy.mockResolvedValue({
      ...conversation,
      documentId: 'guide-a',
    });
    const answer = jest.fn();
    await expect(
      service.runTurn(
        user,
        {
          question: '测试问题',
          conversationId: id.toHexString(),
          documentId: 'guide-b',
        },
        answer,
      ),
    ).rejects.toThrow('切换资料请开始新会话');
    expect(answer).not.toHaveBeenCalled();
  });
  it('does not report an unsaved answer as a successful turn', async () => {
    history.save.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(
      service.runTurn(user, { question: '测试问题' }, () =>
        Promise.resolve(result),
      ),
    ).rejects.toThrow('storage unavailable');
    expect(repo.deleteOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.userId }),
    );
  });
  it('will not generate another turn beyond the bounded session limit', async () => {
    history.conversationRecords.mockResolvedValue(
      Array.from({ length: 100 }, () => ({ question: '已有问题' }) as QaRecord),
    );
    const answer = jest.fn();
    await expect(
      service.runTurn(
        user,
        { question: '测试问题', conversationId: id.toHexString() },
        answer,
      ),
    ).rejects.toThrow('100 轮');
    expect(answer).not.toHaveBeenCalled();
  });
  it('restores records with both the account and conversation filter', async () => {
    await service.detail(id.toHexString(), user.userId);
    expect(history.conversationRecords).toHaveBeenCalledWith(
      user.userId,
      id.toHexString(),
    );
  });

  it('normalizes accepted uppercase IDs before looking up saved turns', async () => {
    await service.detail(id.toHexString().toUpperCase(), user.userId);
    expect(history.conversationRecords).toHaveBeenCalledWith(
      user.userId,
      id.toHexString(),
    );
  });

  it('normalizes response fields once in the persisted snapshot for exact restoration', async () => {
    const output = await service.runTurn(
      user,
      { question: '原始问题', conversationId: id.toHexString() },
      () => Promise.resolve(result),
    );
    expect(output).toMatchObject({
      resolvedQuestion: '原始问题',
      context: { inheritedEntities: [], needsClarification: false },
      documentEvidence: [],
      sections: [],
      conversationId: id.toHexString(),
      recordId: 'saved-id',
    });
    const input = history.save.mock.calls.at(-1)?.[0] as {
      snapshot: QaResponse;
      resolvedQuestion: string;
    };
    expect(input.resolvedQuestion).toBe('原始问题');
    expect(output).toEqual({ ...input.snapshot, recordId: 'saved-id' });
  });
});
