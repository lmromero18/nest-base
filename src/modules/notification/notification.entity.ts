import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NotificationType } from './notification.types';

@Entity({ name: 'tb_notification' })
export class Notification extends BaseEntity {
  @PrimaryGeneratedColumn({ name: 'id_notification' })
  id!: number;

  @Column({ type: 'varchar', length: 255, name: 'nb_subject' })
  subject!: string;

  @Column({ type: 'text', name: 'tx_content' })
  content!: string;

  @Index()
  @Column({ type: 'varchar', length: 255, name: 'nb_destination' })
  destination!: string;

  @Index()
  @Column({ type: 'varchar', length: 16, name: 'nb_type' })
  type!: NotificationType;

  @Index()
  @Column({ type: 'timestamp', nullable: true, name: 'ts_scheduled_at' })
  tsScheduledAt?: Date | null;

  @Index()
  @Column({ type: 'bool', default: false, name: 'is_sent' })
  isSent!: boolean;

  @Column({ type: 'int', default: 0, name: 'nu_attempts' })
  attempts!: number;

  @Column({ type: 'text', nullable: true, name: 'tx_last_error' })
  lastError?: string | null;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'tx_client_id' })
  clientId?: string | null;

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'id_user' })
  userId?: string | null;

  @CreateDateColumn({ name: 'ts_created_at' })
  tsCreatedAt!: Date;

  @UpdateDateColumn({ name: 'ts_updated_at' })
  tsUpdatedAt!: Date;
}
