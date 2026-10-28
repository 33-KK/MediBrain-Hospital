import { MongoRepository } from 'typeorm';
import { ObjectId } from 'mongodb';
import { AccountOperationLockService } from './account-operation-lock.service';
import { AccountOperationLock } from './entities/account-operation-lock.entity';

describe('cross-replica account lease', () => {
  const userId = new ObjectId().toHexString();
  const repo = {
    updateOne: jest.fn<Promise<unknown>, unknown[]>(),
    deleteOne: jest.fn<Promise<unknown>, unknown[]>(),
  };
  const service = new AccountOperationLockService(
    repo as unknown as MongoRepository<AccountOperationLock>,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    repo.deleteOne.mockResolvedValue({ deletedCount: 1 });
  });
  it('rejects a busy lease without executing or releasing another owner', async () => {
    repo.updateOne.mockRejectedValue({ code: 11000 });
    const action = jest.fn();
    await expect(service.run(userId, action)).rejects.toThrow(
      '有问答或历史操作正在进行',
    );
    expect(action).not.toHaveBeenCalled();
    expect(repo.deleteOne).not.toHaveBeenCalled();
  });
  it('checks lease ownership before write and releases only its token', async () => {
    repo.updateOne
      .mockResolvedValueOnce({ upsertedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 1 });
    const result = await service.run(userId, async (assertHeld) => {
      await assertHeld();
      return 'saved';
    });
    expect(result).toBe('saved');
    const acquireCall = repo.updateOne.mock.calls[0] as [
      unknown,
      { $set: { leaseToken: string } },
    ];
    const acquired = acquireCall[1].$set;
    expect(repo.updateOne.mock.calls[1][0]).toMatchObject({
      _id: new ObjectId(userId),
      leaseToken: acquired.leaseToken,
    });
    expect(repo.deleteOne).toHaveBeenCalledWith({
      _id: new ObjectId(userId),
      leaseToken: acquired.leaseToken,
    });
  });
  it('a lost or expired lease cannot save and failure still releases only its token', async () => {
    repo.updateOne
      .mockResolvedValueOnce({ matchedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 0 });
    const write = jest.fn();
    await expect(
      service.run(userId, async (assertHeld) => {
        await assertHeld();
        write();
      }),
    ).rejects.toThrow('有问答或历史操作正在进行');
    expect(write).not.toHaveBeenCalled();
    expect(repo.deleteOne).toHaveBeenCalledTimes(1);
  });
});
