import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, BaseEntity, OneToMany } from "typeorm";
import { SaldoCuenta } from "./saldo-cuenta.entity";

@Entity({
    schema: "ibpcore",
    name: "tb_cuenta"
})
export class Cuenta extends BaseEntity {
    @PrimaryColumn({ type: "varchar", length: 20 })
    co_cuenta!: string;

    @Column({ type: "numeric" })
    id_cliente!: number;

    @Column({ type: "numeric" })
    ti_cuenta!: number;

    @Column({ type: "varchar" })
    st_cuenta!: string;

    @Column({ type: "date", default: () => "now()" })
    fe_creacion_cuenta!: Date;

    @Column({ type: "varchar" })
    co_oficina!: string;

    @Column({ type: "date", nullable: true })
    fe_cierre_cuenta?: Date;

    @Column({ type: "varchar", length: 2048, nullable: true })
    co_alias?: string;

    @Column({ type: "varchar", length: 11, nullable: true })
    co_cele?: string;

    @CreateDateColumn({ type: "timestamp", nullable: true })
    ts_fecha_timestamp_ins?: Date;

    @UpdateDateColumn({ type: "timestamp", nullable: true })
    ts_fecha_timestamp_upd?: Date;

    @Column({ type: "varchar", default: "VES" })
    co_moneda!: string;

    @Column({ type: "varchar", nullable: true })
    co_identificacion?: string;

    @Column({ type: "varchar", nullable: true })
    co_participante?: string;

    @Column({ type: "varchar" })
    co_serie!: string;

    @Column({ type: "bigint", nullable: true })
    id_oficina?: number;

    @OneToMany(() => SaldoCuenta, saldo => saldo.cuenta)
    saldos: SaldoCuenta[];

}
