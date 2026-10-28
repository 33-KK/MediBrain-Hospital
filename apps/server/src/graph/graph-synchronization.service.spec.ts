import { GraphSynchronizationService } from './graph-synchronization.service';
import { EntityRecognitionService } from '../entity/entity-recognition.service';
import { GraphService } from '../neo4j/graph.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { indexTasks } from '../neo4j/index-task';
jest.mock('@zilliz/milvus2-sdk-node', () => ({
  ConsistencyLevelEnum: { Strong: 0 },
  MilvusClient: jest.fn(),
}));
describe('持久图谱变更任务', () => {
  it('失败任务由图谱保存，新进程重试读取最新状态，改名删除旧向量', async () => {
    const tasks = indexTasks('药品', '旧名', '新名');
    const queue = new Map(tasks.map((task) => [task.key, task]));
    const graph = {
      claimIndexTasks: jest.fn(() => Promise.resolve([...queue.values()])),
      getEntitySnapshot: jest.fn((name: string) =>
        Promise.resolve(name === '旧名' ? null : { desc: '最新描述' }),
      ),
      finishIndexTask: jest.fn(
        (task: (typeof tasks)[number], _: string, succeeded: boolean) => {
          if (succeeded) queue.delete(task.key);
          return Promise.resolve();
        },
      ),
    };
    const entity = { reloadDictionary: jest.fn(() => Promise.resolve(1)) };
    const embedding = {
      syncEntity: jest.fn(() => Promise.resolve()),
      removeEntity: jest.fn(() => Promise.resolve()),
    };
    embedding.syncEntity.mockRejectedValueOnce(new Error('Milvus 不可用'));
    const create = () =>
      new GraphSynchronizationService(
        entity as unknown as EntityRecognitionService,
        graph as unknown as GraphService,
        embedding as unknown as EmbeddingService,
      );
    await create().flush();
    expect(queue.size).toBe(1);
    expect(embedding.removeEntity).toHaveBeenCalledWith('旧名', '药品');
    await create().flush();
    expect(embedding.syncEntity).toHaveBeenLastCalledWith(
      '新名',
      '药品',
      '最新描述',
    );
    expect(queue.size).toBe(0);
  });
});
