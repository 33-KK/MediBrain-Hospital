import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ObjectId } from 'mongodb';
import { QaRecord } from './entities/qa-record.entity';
import type { QaResponse } from '../qa/qa-response';
import { Conversation } from '../conversations/entities/conversation.entity';
import { AccountOperationLockService } from '../conversations/account-operation-lock.service';

export interface SaveRecordInput {
  userId: string;
  username: string;
  question: string;
  answer: string;
  dimension?: string;
  provider?: string;
  graphMatched?: boolean;
  entityNames?: string[];
  conversationId?: string;
  resolvedQuestion?: string;
  documentId?: string;
  snapshot?: QaResponse;
}

@Injectable()
export class HistoryService {
  constructor(
    @InjectRepository(QaRecord)
    private readonly recordRepo: Repository<QaRecord>,
    @Optional()
    @InjectRepository(Conversation)
    private readonly conversations?: Repository<Conversation>,
    @Optional() private readonly locks?: AccountOperationLockService,
  ) {}

  /** 保存一条问答记录 */
  async save(input: SaveRecordInput): Promise<QaRecord> {
    const id = new ObjectId();
    const record = this.recordRepo.create({
      ...input,
      _id: id,
      snapshot: input.snapshot
        ? { ...input.snapshot, recordId: id.toHexString() }
        : undefined,
      dimension: input.dimension ?? '',
      provider: input.provider ?? '',
      graphMatched: input.graphMatched ?? false,
      entityNames: input.entityNames ?? [],
      createdAt: new Date(),
    });
    return this.recordRepo.save(record);
  }

  /** 分页查询某用户的问答历史 */
  async listByUser(
    userId: string,
    page = 1,
    pageSize = 20,
  ): Promise<{
    list: QaRecord[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const [list, total] = await this.recordRepo.findAndCount({
      where: { userId },
      select: {
        _id: true,
        userId: true,
        username: true,
        question: true,
        answer: true,
        dimension: true,
        provider: true,
        graphMatched: true,
        entityNames: true,
        conversationId: true,
        resolvedQuestion: true,
        documentId: true,
        snapshot: true,
        createdAt: true,
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }

  /** 仅按记录 ID 与当前用户 ID 删除本人记录。 */
  async remove(id: string, userId: string): Promise<void> {
    if (!/^[a-f\d]{24}$/i.test(id)) {
      throw new BadRequestException('记录 ID 格式不正确');
    }
    await this.mutate(userId, async (assertHeld) => {
      const objectId = new ObjectId(id);
      const record = await this.recordRepo.findOneBy({ _id: objectId, userId });
      if (!record) throw new NotFoundException('记录不存在');
      await assertHeld();
      await this.recordRepo.delete({ _id: objectId, userId });
    });
  }

  /** 清空某用户全部记录 */
  async clearByUser(userId: string): Promise<void> {
    await this.mutate(userId, async (assertHeld) => {
      await assertHeld();
      await this.recordRepo.delete({ userId });
      await assertHeld();
      await this.conversations?.delete({ userId });
    });
  }

  conversationRecords(
    userId: string,
    conversationId: string,
  ): Promise<QaRecord[]> {
    return this.recordRepo.find({
      where: { userId, conversationId },
      select: {
        _id: true,
        userId: true,
        username: true,
        question: true,
        answer: true,
        dimension: true,
        provider: true,
        graphMatched: true,
        entityNames: true,
        createdAt: true,
        conversationId: true,
        resolvedQuestion: true,
        documentId: true,
        snapshot: true,
      },
      order: { createdAt: 'ASC', _id: 'ASC' },
      take: 100,
    });
  }

  conversationCount(userId: string, conversationId: string): Promise<number> {
    return this.recordRepo.countBy({ userId, conversationId });
  }

  private mutate<T>(
    userId: string,
    operation: (assertHeld: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    return this.locks
      ? this.locks.run(userId, operation)
      : operation(() => Promise.resolve());
  }
}
