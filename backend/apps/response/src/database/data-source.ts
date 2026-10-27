import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { postgresOptions } from '../../../../packages/technical/src';
import { InitialResponse1710000000000 } from './migrations/InitialResponse1710000000000';
import { AddRequestSourceIpIndex1710000000001 } from './migrations/AddRequestSourceIpIndex1710000000001';
import { AddEvidenceUploadIpQuota1710000000002 } from './migrations/AddEvidenceUploadIpQuota1710000000002';
import { AddSosFactsAndMissionKind1792953600000 } from './migrations/AddSosFactsAndMissionKind1792953600000';
import { AddAiAdvisory1792953600001 } from './migrations/AddAiAdvisory1792953600001';
import { GrantAiAdvisoryRead1792953600002 } from './migrations/GrantAiAdvisoryRead1792953600002';

export default new DataSource(postgresOptions([InitialResponse1710000000000, AddRequestSourceIpIndex1710000000001, AddEvidenceUploadIpQuota1710000000002, AddSosFactsAndMissionKind1792953600000, AddAiAdvisory1792953600001, GrantAiAdvisoryRead1792953600002], 'response'));
