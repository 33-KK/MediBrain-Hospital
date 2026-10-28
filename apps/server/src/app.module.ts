import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {
  appConfig,
  databaseConfig,
  llmConfig,
  embeddingConfig,
  neo4jConfig,
  minioConfig,
} from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './database/redis.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { LlmModule } from './llm/llm.module';
import { HealthModule } from './health/health.module';
import { Neo4jModule } from './neo4j/neo4j.module';
import { EntityModule } from './entity/entity.module';
import { QaModule } from './qa/qa.module';
import { HistoryModule } from './history/history.module';
import { GraphModule } from './graph/graph.module';
import { TtsModule } from './tts/tts.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { KnowledgeModule } from './knowledge/knowledge.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        llmConfig,
        embeddingConfig,
        neo4jConfig,
        minioConfig,
      ],
      envFilePath: ['.env', '../../.env'],
    }),
    DatabaseModule,
    RedisModule,
    CommonModule,
    AuthModule,
    LlmModule,
    HealthModule,
    Neo4jModule,
    EntityModule,
    QaModule,
    HistoryModule,
    GraphModule,
    TtsModule,
    EmbeddingModule,
    KnowledgeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
