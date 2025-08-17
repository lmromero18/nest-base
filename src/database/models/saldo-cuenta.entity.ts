import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Cuenta } from './cuenta.entity';

@Entity({ schema: 'ibpcore', name: 'tb_saldo_cuenta' })
export class SaldoCuenta {
  @PrimaryColumn({ name: 'co_cuenta', type: 'varchar', length: 20 })
  coCuenta: string;

  @Column({ name: 'mo_saldo', type: 'numeric', precision: 21, scale: 5, default: 0 })
  moSaldo: string;

  @Column({ name: 'mo_saldo_bloqueado', type: 'numeric', precision: 21, scale: 5 })
  moSaldoBloqueado: string;

  @Column({ name: 'mo_saldo_apartado', type: 'numeric', precision: 21, scale: 5 })
  moSaldoApartado: string;

  @Column({ name: 'co_moneda' })
  coMoneda: string;

  // @Column({ name: 'co_participante' })
  // coParticipante: string;

  @Column({ name: 'co_identificacion' })
  coIdentificacion: string;

  @Column({ name: 'co_serie' })
  coSerie: string;

  @Column({ name: 'tx_nombre_cliente', type: 'varchar', nullable: true })
  txNombreCliente?: string;

  @CreateDateColumn({ name: 'ts_fecha_timestamp_ins', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  tsFechaIns?: Date;

  @UpdateDateColumn({ name: 'ts_fecha_timestamp_upd', type: 'timestamp', nullable: true })
  tsFechaUpd?: Date;

  // Relaciones

  @ManyToOne(() => Cuenta, cuenta => cuenta.saldos)
  @JoinColumn({ name: 'co_cuenta' })
  cuenta: Cuenta;

}
