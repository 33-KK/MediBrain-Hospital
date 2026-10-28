import { Module } from '@nestjs/common';
import { GraphSynchronizationService } from './graph-synchronization.service';
import { EmbeddingModule } from '../embedding/embedding.module';

@Module({
  imports: [EmbeddingModule],
  providers: [GraphSynchronizationService],
})
export class GraphModule {}
