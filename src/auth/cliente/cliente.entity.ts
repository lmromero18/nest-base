import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  DeleteDateColumn,
  BeforeInsert,
} from 'typeorm';
import { randomBytes } from 'crypto';
import { Exclude } from 'class-transformer';

@Entity({ name: 'tb_cliente' })
export class Cliente {
  @PrimaryGeneratedColumn('uuid', { name: 'id_cliente' })
  id: string;

  @Column({ name: 'nb_cliente', unique: true })
  nombre: string;

  // Token duration in minutes for this client (used for JWT exp)
  @Column({ name: 'nu_tiempo_token_min', type: 'int', default: 30 })
  nuTiempoTokenMin: number;

  @DeleteDateColumn({ name: 'ts_eliminacion', nullable: true })
  tsEliminacion?: Date;

  @CreateDateColumn({ name: 'ts_creacion' })
  tsCreacion: Date;

  @UpdateDateColumn({ name: 'ts_actualizacion' })
  tsActualizacion: Date;

  // Relation to represent the parent client
  @ManyToOne(() => Cliente, (cliente) => cliente.hijos, { nullable: true })
  @JoinColumn({ name: 'id_cliente_padre' })
  clientePadre: Cliente;

  // Relation to represent the children clients
  @OneToMany(() => Cliente, (cliente) => cliente.clientePadre)
  hijos: Cliente[];

  @Exclude({ toPlainOnly: true })
  @Column({ name: 'tx_secreto', type: 'varchar', length: 128 })
  secreto: string;

  @BeforeInsert()
  generateSecret(): void {
    if (!this.secreto) {
      this.secreto = randomBytes(32).toString('hex');
    }
  }
}
