import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  DeleteDateColumn,
  ManyToMany,
  JoinTable,
} from 'typeorm';
import { Cliente } from '../cliente/cliente.entity';
import { Usuario } from '../usuario/usuario.entity';
import { Permiso } from '../permiso/permiso.entity';

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

  @ManyToMany(() => Usuario, (usuario) => usuario.roles, { cascade: false })
  usuarios?: Usuario[];

  // Permisos asignados a este rol (relación muchos a muchos)
  @ManyToMany(() => Permiso, { cascade: false })
  @JoinTable({
    name: 'tb_rol_permiso',
    joinColumn: { name: 'id_rol', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'id_permiso', referencedColumnName: 'id' },
  })
  permisos?: Permiso[];
}
