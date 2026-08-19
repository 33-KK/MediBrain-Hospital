import { Column, Entity, ObjectIdColumn } from 'typeorm';
import { ObjectId } from 'mongodb';

@Entity('qa_records')
export class QaRecord {
  @ObjectIdColumn()
  _id: ObjectId;

  @Column()
  userId: string;

  @Column()
  username: string;

  @Column({ default: '' })
  identity: string;

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

  @Column({ type: 'timestamp', default: () => new Date() })
  createdAt: Date;
}