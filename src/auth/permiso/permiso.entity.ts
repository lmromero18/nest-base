import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  DeleteDateColumn,
} from 'typeorm';
import { Cliente } from '../cliente/cliente.entity';
import { AuthBaseStatus } from '../auth.interfaces';

@Entity({ name: 'tb_permiso' })
export class Permiso {
  @PrimaryGeneratedColumn({ name: 'id_permiso' })
  id: number;

  @Column({ name: 'co_permiso', unique: true })
  coPermiso: string;

  @CreateDateColumn({ name: 'ts_creacion' })
  tsCreacion: Date;

  @UpdateDateColumn({ name: 'ts_actualizacion' })
  tsActualizacion: Date;

  @DeleteDateColumn({ name: 'ts_eliminacion', nullable: true })
  tsEliminacion?: Date;

  @ManyToOne(() => Cliente, { nullable: false })
  @JoinColumn({ name: 'id_cliente' })
  cliente: Cliente;
}
