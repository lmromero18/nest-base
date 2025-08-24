import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  RelationId,
  UpdateDateColumn,
} from 'typeorm';
import { Usuario } from '../usuario/usuario.entity';
import { Cliente } from '../cliente/cliente.entity';

@Entity({ name: 'tb_token_acceso' })
export class TokenAcceso {
  @PrimaryGeneratedColumn('uuid', { name: 'id_jid' })
  jid: string;

  @ManyToOne(() => Usuario, { nullable: false })
  @JoinColumn({ name: 'id_usuario' })
  usuario: Usuario;

  @RelationId((token: TokenAcceso) => token.usuario)
  @Column({ name: 'id_usuario' })
  usuarioId: number;

  @ManyToOne(() => Cliente, { nullable: false })
  @JoinColumn({ name: 'id_cliente' })
  cliente: Cliente;

  @RelationId((token: TokenAcceso) => token.cliente)
  @Column({ name: 'id_cliente' })
  clienteId: string;

  @Column({ name: 'is_revocado', default: false })
  isRevocado: boolean;

  @Column({ name: 'ts_expiracion' })
  tsExpiracion: Date;

  @Column({ name: 'nu_duracion_min', type: 'int', default: 30 })
  nuDuracionMin: number;

  @CreateDateColumn({ name: 'ts_creacion' })
  tsCreacion: Date;

  @UpdateDateColumn({ name: 'ts_actualizacion' })
  tsActualizacion: Date;
}
