import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'tb_carro' })
export class Carro extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 50 })
  nb_marca!: string;

  @Column({ type: 'varchar', length: 50 })
  nb_modelo!: string;

  @Column({ type: 'int', nullable: true })
  nu_anio?: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  mo_monto?: number;

  @Column({ type: 'bool', default: true, nullable: true })
  is_disponible?: boolean;
}
