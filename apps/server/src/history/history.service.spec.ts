import { ObjectId } from 'mongodb';
import { Repository } from 'typeorm';
import { HistoryService } from './history.service';
import { QaRecord } from './entities/qa-record.entity';

describe('统一账号下的个人历史隔离', () => {
  const repo = {
    findAndCount: jest.fn<Promise<[QaRecord[], number]>, [unknown]>(),
    findOneBy: jest.fn(),
    delete: jest.fn(),
  };
  const service = new HistoryService(repo as unknown as Repository<QaRecord>);
  beforeEach(() => jest.clearAllMocks());

  it('列表仅查询本人并明确选择字段，旧身份字段不返回', async () => {
    repo.findAndCount.mockResolvedValueOnce([[], 0]);
    await service.listByUser('owner');
    const options = repo.findAndCount.mock.calls[0]?.[0] as {
      where: { userId: string };
      select: Record<string, boolean>;
    };
    expect(options.where).toEqual({ userId: 'owner' });
    expect(Object.keys(options.select)).not.toContain('identity');
    expect(Object.keys(options.select)).not.toContain('role');
  });

  it('不能通过其他用户的记录 ID 删除其历史', async () => {
    const id = new ObjectId();
    repo.findOneBy.mockResolvedValueOnce(null);
    await expect(service.remove(id.toString(), 'owner')).rejects.toThrow(
      '记录不存在',
    );
    expect(repo.findOneBy).toHaveBeenCalledWith({ _id: id, userId: 'owner' });
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('删除条件再次限定本人，清空也只作用于本人', async () => {
    const id = new ObjectId();
    repo.findOneBy.mockResolvedValueOnce({ _id: id, userId: 'owner' });
    await service.remove(id.toString(), 'owner');
    expect(repo.delete).toHaveBeenCalledWith({ _id: id, userId: 'owner' });
    await service.clearByUser('owner');
    expect(repo.delete).toHaveBeenLastCalledWith({ userId: 'owner' });
  });
});
