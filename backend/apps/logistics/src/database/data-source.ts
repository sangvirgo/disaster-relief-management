import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { postgresOptions } from '@c48/technical';
import { InitialLogistics1710000000000 } from './migrations/InitialLogistics1710000000000';
import { RemoveRegionAttribution1794700800000 } from './migrations/RemoveRegionAttribution1794700800000';
import { RemoveOrganizationLogistics1794787200000 } from './migrations/RemoveOrganizationLogistics1794787200000';
import { AddWarehouseServiceRadius1795219200000 } from './migrations/AddWarehouseServiceRadius1795219200000';
import { AddCampaignWarehouseAssignment1795478400000 } from './migrations/AddCampaignWarehouseAssignment1795478400000';
import { AddNeedEstimates1795392000000 } from './migrations/AddNeedEstimates1795392000000';
import { AddSupplyGaps1795564800000 } from './migrations/AddSupplyGaps1795564800000';
import { AddPickupTickets1795651200000 } from './migrations/AddPickupTickets1795651200000';
import { AddPickupCloseout1795737600000 } from './migrations/AddPickupCloseout1795737600000';
import { GrantCampaignWarehouseAccess1795824000000 } from './migrations/GrantCampaignWarehouseAccess1795824000000';
import { AddNeedExtractionLog1795910400000 } from './migrations/AddNeedExtractionLog1795910400000';
import { RepairLegacyNeedEstimateSchema1795996800000 } from './migrations/RepairLegacyNeedEstimateSchema1795996800000';
import { AllowUnusedItemDeletion1796083200000 } from './migrations/AllowUnusedItemDeletion1796083200000';
import { RemoveVehicles1796169600000 } from './migrations/RemoveVehicles1796169600000';
import { RemoveReliefPoints1796256000000 } from './migrations/RemoveReliefPoints1796256000000';
import { AddDonationDriveLocation1796342400000 } from './migrations/AddDonationDriveLocation1796342400000';
import { AllowApproverDispatch1796428800000 } from './migrations/AllowApproverDispatch1796428800000';
import { ReplaceDistributionWithSupplyRequests1796515200000 } from './migrations/ReplaceDistributionWithSupplyRequests1796515200000';
import { UsePackagedItemUnits1796601600000 } from './migrations/UsePackagedItemUnits1796601600000';

export default new DataSource(postgresOptions([
  InitialLogistics1710000000000,
  RemoveRegionAttribution1794700800000,
  RemoveOrganizationLogistics1794787200000,
  AddWarehouseServiceRadius1795219200000,
  AddNeedEstimates1795392000000,
  AddCampaignWarehouseAssignment1795478400000,
  AddSupplyGaps1795564800000,
  AddPickupTickets1795651200000,
  AddPickupCloseout1795737600000,
  GrantCampaignWarehouseAccess1795824000000,
  AddNeedExtractionLog1795910400000,
  RepairLegacyNeedEstimateSchema1795996800000,
  AllowUnusedItemDeletion1796083200000,
  RemoveVehicles1796169600000,
  RemoveReliefPoints1796256000000,
  AddDonationDriveLocation1796342400000,
  AllowApproverDispatch1796428800000,
  ReplaceDistributionWithSupplyRequests1796515200000,
  UsePackagedItemUnits1796601600000,
], 'logistics'));
