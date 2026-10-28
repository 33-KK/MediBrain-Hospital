import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { ObjectId, type UpdateResult } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { AccountOperationLock } from './entities/account-operation-lock.entity';

/** One account's history mutations and turns share a renewable cross-Pod lease. */
@Injectable()
export class AccountOperationLockService {
  private readonly logger = new Logger(AccountOperationLockService.name);
  private readonly leaseMs = 180_000;

  constructor(
    @InjectRepository(AccountOperationLock)
    private readonly locks: MongoRepository<AccountOperationLock>,
  ) {}

  async run<T>(
    userId: string,
    action: (assertHeld: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    const _id = new ObjectId(userId);
    const leaseToken = randomUUID();
    const busy = () =>
      new ConflictException('有问答或历史操作正在进行，请稍后重试');
    try {
      const result = (await this.locks.updateOne(
        {
          _id,
          $or: [
            { leaseUntil: { $exists: false } },
            { leaseUntil: { $lte: new Date() } },
          ],
        },
        {
          $set: { leaseToken, leaseUntil: new Date(Date.now() + this.leaseMs) },
        },
        { upsert: true },
      )) as UpdateResult;
      if (!result.matchedCount && !result.upsertedCount) throw busy();
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      )
        throw busy();
      throw error;
    }

    let lost = false;
    const assertHeld = async () => {
      if (lost) throw busy();
      const result = (await this.locks.updateOne(
        { _id, leaseToken, leaseUntil: { $gt: new Date() } },
        { $set: { leaseUntil: new Date(Date.now() + this.leaseMs) } },
      )) as UpdateResult;
      if (!result.matchedCount) {
        lost = true;
        throw busy();
      }
    };
    const heartbeat = setInterval(() => {
      void assertHeld().catch(() => {
        lost = true;
      });
    }, 30_000);
    heartbeat.unref();
    try {
      return await action(assertHeld);
    } finally {
      clearInterval(heartbeat);
      await this.locks.deleteOne({ _id, leaseToken }).catch(() => {
        this.logger.warn('账号操作锁释放失败，将在租约到期后恢复');
      });
    }
  }
}
