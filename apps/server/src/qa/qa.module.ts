import { Module } from '@nestjs/common';
import { QaService } from './qa.service';
import { QaController } from './qa.controller';
import { HistoryModule } from '../history/history.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { DocumentQaService } from '../knowledge/document-qa.service';

@Module({
  imports: [
    HistoryModule,
    EmbeddingModule,
    KnowledgeModule,
    ConversationsModule,
  ],
  providers: [QaService, DocumentQaService],
  controllers: [QaController],
  exports: [QaService],
})
export class QaModule {}
