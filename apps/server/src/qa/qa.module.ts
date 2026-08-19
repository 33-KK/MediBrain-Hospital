import { Module } from '@nestjs/common';
import { QaService } from './qa.service';
import { QaController } from './qa.controller';
import { HistoryModule } from '../history/history.module';
import { EmbeddingModule } from '../embedding/embedding.module';

@Module({
  imports: [HistoryModule, EmbeddingModule],
  providers: [QaService],
  controllers: [QaController],
  exports: [QaService],
})
export class QaModule {}
