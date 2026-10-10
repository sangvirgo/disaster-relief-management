import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { postgresOptions } from '../../../../packages/technical/src';
import { InitialResponse1710000000000 } from './migrations/InitialResponse1710000000000';

export default new DataSource(postgresOptions([InitialResponse1710000000000]));
