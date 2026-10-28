import { Column, Entity, ObjectIdColumn } from 'typeorm';
import { ObjectId } from 'mongodb';

@Entity('users')
export class User {
  @ObjectIdColumn()
  _id: ObjectId;

  @Column({ unique: true })
  username: string;

  @Column({ select: false })
  password: string;

  @Column({ default: '' })
  displayName: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', default: () => new Date() })
  createdAt: Date;
}
