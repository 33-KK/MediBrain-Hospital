import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ObjectId } from 'mongodb';
import { QaRecord } from './entities/qa-record.entity';

export interface SaveRecordInput {
  userId: string;
  username: string;
  identity?: string;
  question: string;
  answer: string;
  dimension?: string;
  provider?: string;
  graphMatched?: boolean;
  entityNames?: string[];
}

@Injectable()
export class HistoryService {
  constructor(
    @InjectRepository(QaRecord)
    private readonly recordRepo: Repository<QaRecord>,
  ) {}

  /** 保存一条问答记录 */
  async save(input: SaveRecordInput): Promise<QaRecord> {
    const record = this.recordRepo.create({
      ...input,
      identity: input.identity ?? '',
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
  ): Promise<{ list: QaRecord[]; total: number; page: number; pageSize: number }> {
    const [list, total] = await this.recordRepo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }

  /** 管理端：分页查询全部记录 */
  async listAll(
    page = 1,
    pageSize = 20,
  ): Promise<{ list: QaRecord[]; total: number; page: number; pageSize: number }> {
    const [list, total] = await this.recordRepo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }

  /** 删除单条记录（仅本人或 admin） */
  async remove(id: string, userId: string, isAdmin: boolean): Promise<void> {
    const record = await this.recordRepo.findOneBy({ _id: new ObjectId(id) });
    if (!record) throw new NotFoundException('记录不存在');
    if (!isAdmin && record.userId !== userId) {
      throw new NotFoundException('记录不存在');
    }
    await this.recordRepo.delete({ _id: new ObjectId(id) });
  }

  /** 清空某用户全部记录 */
  async clearByUser(userId: string): Promise<void> {
    await this.recordRepo.delete({ userId });
  }
}