import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { EmbeddingModule } from '../embedding/embedding.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [TerminusModule, EmbeddingModule, LlmModule],
  controllers: [HealthController],
})
export class HealthModule {}
