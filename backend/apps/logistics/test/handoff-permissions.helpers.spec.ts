import type { Grant } from '@c48/identity-contracts/permissions';
import { requireHandoffPermission } from '../src/distributions/handoff-permissions.helpers';

const distribution = { organization_id: 'organization-1', warehouse_region_code: 'REGION_1' };
const scopedCoordinator: Grant[] = [
  { role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: 'organization-1' },
];

function thrownBy(operation: () => void): unknown {
  try {
    operation();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('requireHandoffPermission', () => {
  it('requires HANDOFF_RECORD for handoff replays even when warehouse scope remains', () => {
    expect(thrownBy(() => requireHandoffPermission(scopedCoordinator, 'HANDOFF_RECORD', distribution)))
      .toMatchObject({ code: 'FORBIDDEN' });
  });

  it('requires LOSS_APPROVE for loss review replays even when warehouse scope remains', () => {
    expect(thrownBy(() => requireHandoffPermission(scopedCoordinator, 'LOSS_APPROVE', distribution)))
      .toMatchObject({ code: 'FORBIDDEN' });
  });
});
