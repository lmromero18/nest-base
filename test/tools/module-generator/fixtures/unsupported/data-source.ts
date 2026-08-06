import { DataSource } from 'typeorm';

const entities: never[] = [];

export default new DataSource({ type: 'postgres', entities });
