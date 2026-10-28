import { Column, Entity, Index, ObjectIdColumn } from 'typeorm';
import { ObjectId } from 'mongodb';

@Entity('qa_conversations')
@Index(['userId', 'updatedAt'])
export class Conversation {
  @ObjectIdColumn()
  _id: ObjectId;

  @Column()
  userId: string;

  @Column()
  title: string;

  @Column()
  documentId?: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
