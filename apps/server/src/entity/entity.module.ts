import { Global, Module } from '@nestjs/common';
import { EntityRecognitionService } from './entity-recognition.service';

@Global()
@Module({
  providers: [EntityRecognitionService],
  exports: [EntityRecognitionService],
})
export class EntityModule {}
