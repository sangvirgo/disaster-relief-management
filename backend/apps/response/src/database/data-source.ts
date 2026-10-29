import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { postgresOptions } from '@c48/technical';
import { InitialResponse1710000000000 } from './migrations/InitialResponse1710000000000';
import { AddRequestSourceIpIndex1710000000001 } from './migrations/AddRequestSourceIpIndex1710000000001';
import { AddEvidenceUploadIpQuota1710000000002 } from './migrations/AddEvidenceUploadIpQuota1710000000002';
import { AddSosFactsAndMissionKind1792953600000 } from './migrations/AddSosFactsAndMissionKind1792953600000';
import { AddAiAdvisory1792953600001 } from './migrations/AddAiAdvisory1792953600001';
import { GrantAiAdvisoryRead1792953600002 } from './migrations/GrantAiAdvisoryRead1792953600002';
import { AllowAiAdvisoryRetries1793116235000 } from './migrations/AllowAiAdvisoryRetries1793116235000';
import { AllowAiAdvisoryRetryAttempts1793117000000 } from './migrations/AllowAiAdvisoryRetryAttempts1793117000000';
import { AddAiAdvisoryClaimToken1793122000000 } from './migrations/AddAiAdvisoryClaimToken1793122000000';

export default new DataSource(postgresOptions([InitialResponse1710000000000, AddRequestSourceIpIndex1710000000001, AddEvidenceUploadIpQuota1710000000002, AddSosFactsAndMissionKind1792953600000, AddAiAdvisory1792953600001, GrantAiAdvisoryRead1792953600002, AllowAiAdvisoryRetries1793116235000, AllowAiAdvisoryRetryAttempts1793117000000, AddAiAdvisoryClaimToken1793122000000], 'response'));
