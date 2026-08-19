import { Column, Entity, ObjectIdColumn } from 'typeorm';
import { ObjectId } from 'mongodb';

export enum UserRole {
  ADMIN = 'admin',
  DOCTOR = 'doctor',
  USER = 'user',
}

export enum UserIdentity {
  DOCTOR = '医生',
  NURSE = '护士',
  PHARMACIST = '药师',
  MEDICAL_STUDENT = '医学生',
  PATIENT = '患者',
  FAMILY = '患者家属',
  NORMAL = '普通用户',
}

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

  @Column({ default: UserRole.USER })
  role: UserRole;

  @Column({ default: UserIdentity.NORMAL })
  identity: UserIdentity;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', default: () => new Date() })
  createdAt: Date;
}
