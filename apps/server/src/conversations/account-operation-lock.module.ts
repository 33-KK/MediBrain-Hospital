import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountOperationLock } from './entities/account-operation-lock.entity';
import { AccountOperationLockService } from './account-operation-lock.service';

@Module({
  imports: [TypeOrmModule.forFeature([AccountOperationLock])],
  providers: [AccountOperationLockService],
  exports: [AccountOperationLockService],
})
export class AccountOperationLockModule {}
