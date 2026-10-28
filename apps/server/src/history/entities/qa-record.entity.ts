import { Column, Entity, Index, ObjectIdColumn } from 'typeorm';
import { ObjectId } from 'mongodb';
import type { QaResponse } from '../../qa/qa-response';

@Entity('qa_records')
@Index(['userId', 'conversationId', 'createdAt', '_id'])
export class QaRecord {
  @ObjectIdColumn()
  _id: ObjectId;

  @Column()
  userId: string;

  @Column()
  username: string;

  @Column({ type: 'string' })
  question: string;

  @Column({ type: 'string' })
  answer: string;

  @Column({ default: '' })
  dimension: string;

  @Column({ default: '' })
  provider: string;

  @Column({ default: false })
  graphMatched: boolean;

  @Column({ type: 'simple-array', default: [] })
  entityNames: string[];

  @Column()
  conversationId?: string;

  @Column()
  resolvedQuestion?: string;

  @Column()
  documentId?: string;

  @Column()
  snapshot?: QaResponse;

  @Column({ type: 'timestamp', default: () => new Date() })
  createdAt: Date;
}
