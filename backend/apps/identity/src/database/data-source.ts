import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { postgresOptions } from '@c48/technical';
import { InitialIdentity1710000000000 } from './migrations/InitialIdentity1710000000000';
import { AddPendingEmailRegistration1792953600001 } from './migrations/AddPendingEmailRegistration1792953600001';
import { AddAuthEmailOtpGoogle1792953600000 } from './migrations/AddAuthEmailOtpGoogle1792953600000';

export default new DataSource(postgresOptions([InitialIdentity1710000000000, AddAuthEmailOtpGoogle1792953600000, AddPendingEmailRegistration1792953600001], 'identity'));
