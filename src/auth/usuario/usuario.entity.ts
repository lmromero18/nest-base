import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  RelationId,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Cliente } from '../cliente/cliente.entity';
import { Rol } from '../rol/rol.entity';

@Entity({ name: 'tb_usuario' })
export class Usuario {
  @PrimaryGeneratedColumn({ name: 'id_usuario' })
  id: number;

  @Column({ name: 'nb_username', unique: true })
  username: string;

  @Exclude({ toPlainOnly: true })
  @Column({ name: 'tx_contrasena' })
  contrasena: string;

  @Column({ name: 'tx_correo', unique: true })
  correo: string;

  @Column({ name: 'is_email_verificado', default: false })
  isEmailVerificado: boolean;

  @DeleteDateColumn({ name: 'ts_eliminacion', nullable: true })
  tsEliminacion?: Date;

  @Column({ name: 'json_atributos', type: 'json', nullable: true, default: {} })
  jsonAtributos?: Record<string, any>;

  @CreateDateColumn({ name: 'ts_creacion' })
  tsCreacion: Date;

  @UpdateDateColumn({ name: 'ts_actualizacion' })
  tsActualizacion: Date;

  @ManyToOne(() => Cliente, { nullable: false })
  @JoinColumn({ name: 'id_cliente' })
  cliente: Cliente;

  @RelationId((usuario: Usuario) => usuario.cliente)
  @Column({ name: 'id_cliente' })
  clienteId: number;

  @ManyToMany(() => Rol, (rol) => rol.usuarios, { cascade: false })
  @JoinTable({
    name: 'tb_usuario_rol',
    joinColumn: { name: 'id_usuario', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'id_rol', referencedColumnName: 'id' },
  })
  roles?: Rol[];
}
