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
], 'logistics'));
