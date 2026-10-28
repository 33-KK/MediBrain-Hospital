import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { ObjectId } from 'mongodb';
import { Conversation } from './entities/conversation.entity';
import { AccountOperationLockService } from './account-operation-lock.service';
import { HistoryService } from '../history/history.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import type { QaResponse } from '../qa/qa-response';
import type { QaRecord } from '../history/entities/qa-record.entity';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversations: MongoRepository<Conversation>,
    private readonly history: HistoryService,
    private readonly locks: AccountOperationLockService,
  ) {}

  private id(value: string) {
    if (!/^[a-f\d]{24}$/i.test(value))
      throw new BadRequestException('会话 ID 格式不正确');
    return new ObjectId(value);
  }

  private summary(conversation: Conversation) {
    return {
      _id: conversation._id.toHexString(),
      title: conversation.title,
      documentId: conversation.documentId,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  private async owned(id: string, userId: string) {
    const conversation = await this.conversations.findOneBy({
      _id: this.id(id),
      userId,
    });
    if (!conversation) throw new NotFoundException('会话不存在');
    return conversation;
  }

  async list(userId: string, page = 1, pageSize = 20) {
    const [list, total] = await this.conversations.findAndCount({
      where: { userId },
      select: {
        _id: true,
        title: true,
        documentId: true,
        createdAt: true,
        updatedAt: true,
      },
      order: { updatedAt: 'DESC', _id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      list: list.map((item) => this.summary(item)),
      total,
      page,
      pageSize,
    };
  }

  async detail(id: string, userId: string) {
    const conversation = await this.owned(id, userId);
    return {
      conversation: this.summary(conversation),
      records: await this.history.conversationRecords(
        userId,
        conversation._id.toHexString(),
      ),
    };
  }

  async rename(id: string, userId: string, title: string) {
    const normalized = title.trim();
    if (!normalized || normalized.length > 80)
      throw new BadRequestException('会话标题须为 1 至 80 个字符');
    await this.owned(id, userId);
    return this.locks.run(userId, async (assertHeld) => {
      const conversation = await this.owned(id, userId);
      const updatedAt = new Date();
      await assertHeld();
      await this.conversations.updateOne(
        { _id: conversation._id, userId },
        { $set: { title: normalized, updatedAt } },
      );
      return this.summary({ ...conversation, title: normalized, updatedAt });
    });
  }

  async runTurn(
    user: AuthenticatedUser,
    options: { question: string; conversationId?: string; documentId?: string },
    answer: (
      conversation: Conversation,
      records: QaRecord[],
    ) => Promise<QaResponse>,
  ): Promise<QaResponse> {
    // Check ownership before acquiring a lease so another user's ID always returns 404.
    if (options.conversationId)
      await this.owned(options.conversationId, user.userId);
    return this.locks.run(user.userId, async (assertHeld) => {
      let conversation: Conversation;
      const created = !options.conversationId;
      if (options.conversationId) {
        conversation = await this.owned(options.conversationId, user.userId);
        if (
          options.documentId &&
          options.documentId !== conversation.documentId
        )
          throw new BadRequestException('切换资料请开始新会话');
      } else {
        const now = new Date();
        conversation = this.conversations.create({
          _id: new ObjectId(),
          userId: user.userId,
          title: Array.from(options.question.trim().replace(/\s+/g, ' '))
            .slice(0, 42)
            .join(''),
          ...(options.documentId ? { documentId: options.documentId } : {}),
          createdAt: now,
          updatedAt: now,
        });
        await assertHeld();
        await this.conversations.save(conversation);
      }
      const conversationId = conversation._id.toHexString();
      try {
        const records = await this.history.conversationRecords(
          user.userId,
          conversationId,
        );
        if (records.length >= 100)
          throw new BadRequestException('此会话已达 100 轮，请开始新会话');
        const result = await answer(conversation, records);
        await assertHeld();
        const snapshot: QaResponse = {
          ...result,
          resolvedQuestion: result.resolvedQuestion ?? options.question,
          context: result.context ?? {
            inheritedEntities: [],
            needsClarification: false,
          },
          documentEvidence: result.documentEvidence ?? [],
          sections: result.sections ?? [],
          conversationId,
        };
        const saved = await this.history.save({
          userId: user.userId,
          username: user.username,
          question: options.question,
          answer: result.answer,
          dimension: result.dimension ?? '',
          provider: result.provider,
          graphMatched: result.graphMatched,
          entityNames: result.entities.map((item) => item.name),
          conversationId,
          documentId: conversation.documentId,
          resolvedQuestion: snapshot.resolvedQuestion,
          snapshot,
        });
        await this.conversations.updateOne(
          { _id: conversation._id, userId: user.userId },
          { $set: { updatedAt: new Date() } },
        );
        return saved.snapshot!;
      } catch (error) {
        if (created) {
          // Never discard metadata if a write succeeded but its acknowledgement was lost.
          try {
            await assertHeld();
            if (
              !(await this.history.conversationCount(
                user.userId,
                conversationId,
              ))
            ) {
              await assertHeld();
              await this.conversations.deleteOne({
                _id: conversation._id,
                userId: user.userId,
              });
            }
          } catch {
            /* Leave recoverable metadata when storage is unavailable. */
          }
        }
        throw error;
      }
    });
  }
}
