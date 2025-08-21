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

@Entity({ name: 'tb_rol' })
export class Rol {
  @PrimaryGeneratedColumn({ name: 'id_rol' })
  id: number;

  @Column({ name: 'nb_rol', unique: true })
  nombre: string;

  @DeleteDateColumn({ name: 'ts_eliminacion', nullable: true })
  tsEliminacion?: Date;

  @CreateDateColumn({ name: 'ts_creacion' })
  tsCreacion: Date;

  @UpdateDateColumn({ name: 'ts_actualizacion' })
  tsActualizacion: Date;

  @ManyToOne(() => Cliente, { nullable: false })
  @JoinColumn({ name: 'id_cliente' })
  cliente: Cliente;
}
