import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HistoryService } from './history.service';
import { HistoryController } from './history.controller';
import { QaRecord } from './entities/qa-record.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { AccountOperationLockModule } from '../conversations/account-operation-lock.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([QaRecord, Conversation]),
    AccountOperationLockModule,
  ],
  providers: [HistoryService],
  controllers: [HistoryController],
  exports: [HistoryService],
})
export class HistoryModule {}
