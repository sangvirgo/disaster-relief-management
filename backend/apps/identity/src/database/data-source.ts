import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { postgresOptions } from '../../../../packages/technical/src';
import { InitialIdentity1710000000000 } from './migrations/InitialIdentity1710000000000';

export default new DataSource(postgresOptions([InitialIdentity1710000000000], 'identity'));
