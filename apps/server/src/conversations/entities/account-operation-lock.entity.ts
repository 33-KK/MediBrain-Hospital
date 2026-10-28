import { Column, Entity, ObjectIdColumn } from 'typeorm';
import { ObjectId } from 'mongodb';

@Entity('qa_account_locks')
export class AccountOperationLock {
  @ObjectIdColumn()
  _id: ObjectId;

  @Column()
  leaseToken: string;

  @Column()
  leaseUntil: Date;
}
