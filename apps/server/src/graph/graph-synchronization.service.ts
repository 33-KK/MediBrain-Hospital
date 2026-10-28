import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityRecognitionService } from '../entity/entity-recognition.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { GraphService } from '../neo4j/graph.service';

/** Tasks commit in Neo4j with graph changes and survive Redis/process outages. */
@Injectable()
export class GraphSynchronizationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(GraphSynchronizationService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly entity: EntityRecognitionService,
    private readonly graph: GraphService,
    private readonly embedding: EmbeddingService,
  ) {}
  async onModuleInit() {
    await this.graph.ensureIndexTaskSchema();
    this.timer = setInterval(() => {
      void this.flush();
    }, 30_000);
    this.timer.unref();
    void this.flush();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  async changed(): Promise<void> {
    await this.entity
      .reloadDictionary()
      .catch((error: Error) =>
        this.logger.warn(`词典刷新待重试: ${error.message}`),
      );
    void this.flush();
  }
  async flush(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const owner = randomUUID();
    try {
      const tasks = await this.graph.claimIndexTasks(owner);
      await Promise.all(
        tasks.map(async (task) => {
          let succeeded = false;
          try {
            const snapshot = await this.graph.getEntitySnapshot(
              task.name,
              task.label,
            );
            if (snapshot)
              await this.embedding.syncEntity(
                task.name,
                task.label,
                snapshot.desc,
              );
            else await this.embedding.removeEntity(task.name, task.label);
            succeeded = true;
          } catch (error) {
            this.logger.warn(`图谱检索同步待重试: ${(error as Error).message}`);
          } finally {
            await this.graph
              .finishIndexTask(task, owner, succeeded)
              .catch((error: Error) =>
                this.logger.warn(`图谱同步状态待重试: ${error.message}`),
              );
          }
        }),
      );
    } catch (error) {
      this.logger.warn(`图谱同步暂不可用: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
