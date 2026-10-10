import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { postgresOptions } from '../../../../packages/technical/src';
import { InitialLogistics1710000000000 } from './migrations/InitialLogistics1710000000000';

export default new DataSource(postgresOptions([InitialLogistics1710000000000]));
