import { Global, Module } from '@nestjs/common';
import { LlmGateway } from './llm.gateway';

@Global()
@Module({
  providers: [LlmGateway],
  exports: [LlmGateway],
})
export class LlmModule {}
