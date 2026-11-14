import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { postgresOptions } from '@c48/technical';
import { InitialLogistics1710000000000 } from './migrations/InitialLogistics1710000000000';
import { RemoveRegionAttribution1794700800000 } from './migrations/RemoveRegionAttribution1794700800000';
import { RemoveOrganizationLogistics1794787200000 } from './migrations/RemoveOrganizationLogistics1794787200000';

export default new DataSource(postgresOptions([
  InitialLogistics1710000000000,
  RemoveRegionAttribution1794700800000,
  RemoveOrganizationLogistics1794787200000,
], 'logistics'));
