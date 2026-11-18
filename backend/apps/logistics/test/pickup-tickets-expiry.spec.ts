import { describe, expect, it, jest } from '@jest/globals';
import { PickupTicketExpiryService } from '../src/pickup-tickets/pickup-tickets-expiry.service';
import { loadPickupTicketJobConfig, PICKUP_TICKET_JOB_INTERVAL_MS } from '../src/pickup-tickets/pickup-tickets-scheduler.service';

const TICKET = '40000000-0000-4000-8000-000000000001';
const DIST = '40000000-0000-4000-8000-000000000002';
const NEED = '40000000-0000-4000-8000-000000000003';
const COMMITMENT = '40000000-0000-4000-8000-000000000004';
const WAREHOUSE = '40000000-0000-4000-8000-000000000005';
const ITEM = '40000000-0000-4000-8000-000000000006';
const RESERVER = '40000000-0000-4000-8000-000000000007';
const TEAM = '40000000-0000-4000-8000-000000000008';

function sweepManager(cycleState: 'OPEN' | 'SEALED') {
  const movements: unknown[][] = [];
  const audits: unknown[][] = [];
  const sql: string[] = [];
  const ticket = {
    id: TICKET, warehouse_id: WAREHOUSE, campaign_id: null, team_id: TEAM, status: 'READY', distribution_id: DIST,
    ready_at: '2026-11-16T00:00:00.000Z', reserved_by: RESERVER, confirmed_by: null, confirmed_at: null, handed_over_by: null,
    handed_over_at: null, collected_by_user_id: null, cancelled_at: null, cancel_reason: null, version: 3, mission_id: 'm', request_id: 'r',
    created_at: '2026-11-16T00:00:00.000Z', updated_at: '2026-11-16T00:00:00.000Z',
  };
  const query = jest.fn(async (text: string, params: unknown[] = []): Promise<unknown[]> => {
    sql.push(text);
    if (/FROM pickup_ticket\s+WHERE status = 'READY'/u.test(text)) return [{ id: TICKET, reserved_by: RESERVER }];
    if (text.includes('FROM pickup_ticket WHERE id=$1 FOR UPDATE')) return [{ ...ticket }];
    if (text.includes('FROM distribution WHERE id=$1 FOR UPDATE')) return [{ id: DIST, status: 'APPROVED', version: 2 }];
    if (text.includes('FROM pickup_ticket_line l JOIN item i')) {
      return [{
        ticket_id: TICKET, relief_need_id: NEED, commitment_id: COMMITMENT, item_id: ITEM, item_name: 'Nước', unit_code: 'CAI',
        unit_scale: 0, requested_quantity: '4', reserved_quantity: '4',
      }];
    }
    if (text.includes('FOR UPDATE OF c')) return [{ state: cycleState }];
    if (text.includes('FROM commitment WHERE id=$1 FOR UPDATE')) {
      return [{ id: COMMITMENT, warehouse_id: WAREHOUSE, item_id: ITEM, version: 2, quantity: '4', released_quantity: '0', issued_quantity: '0' }];
    }
    if (text.includes('SELECT id FROM stock_balance')) return [{ id: 'balance-1' }];
    if (text.startsWith('INSERT INTO stock_movement')) {
      movements.push(params);
      return [];
    }
    if (text.startsWith('INSERT INTO audit_log')) {
      audits.push(params);
      return [];
    }
    return [];
  });
  return { manager: { query } as never, query, movements, audits, sql };
}

describe('PickupTicketExpiryService.sweep', () => {
  it('cancels an unconfirmed READY ticket, releases its reservation with the reserver as actor, and cancels the draft', async () => {
    const m = sweepManager('OPEN');
    const expired = await new PickupTicketExpiryService().sweep(m.manager);

    expect(expired).toBe(1);
    expect(m.movements).toEqual([[
      'balance-1', '4', COMMITMENT, `COMMITMENT_RELEASE:${COMMITMENT}:2`, RESERVER,
    ]]);
    expect(m.sql.some((text) => text.includes("UPDATE commitment SET released_quantity=released_quantity+$2::numeric,version=version+1"))).toBe(true);
    expect(m.sql.some((text) => text.includes("UPDATE distribution SET status='CANCELLED'"))).toBe(true);
    expect(m.sql.some((text) => text.includes("UPDATE pickup_ticket SET status='CANCELLED'"))).toBe(true);
    expect(m.audits[0]?.[1]).toBe('PICKUP_TICKET_EXPIRED');
  });

  it('leaves a ticket whose cycle is SEALED untouched for a coordinator', async () => {
    const m = sweepManager('SEALED');
    expect(await new PickupTicketExpiryService().sweep(m.manager)).toBe(0);
    expect(m.movements).toHaveLength(0);
    expect(m.sql.some((text) => text.includes("UPDATE pickup_ticket SET status='CANCELLED'"))).toBe(false);
  });

  it('claims only READY tickets older than 24 hours that nobody confirmed', async () => {
    const m = sweepManager('OPEN');
    await new PickupTicketExpiryService().sweep(m.manager);
    const claim = m.sql.find((text) => text.includes("status = 'READY'")) ?? '';
    expect(claim).toContain("confirmed_at IS NULL");
    expect(claim).toContain("interval '24 hours'");
    expect(claim).toContain('ORDER BY');
  });
});

describe('loadPickupTicketJobConfig', () => {
  it('runs the expiry sweep when the flag is unset or true, and disables it only for false', () => {
    expect(loadPickupTicketJobConfig({})).toEqual({ enabled: true, intervalMs: PICKUP_TICKET_JOB_INTERVAL_MS });
    expect(loadPickupTicketJobConfig({ C48_PICKUP_TICKET_JOB_ENABLED: 'true' }).enabled).toBe(true);
    expect(loadPickupTicketJobConfig({ C48_PICKUP_TICKET_JOB_ENABLED: 'false' }).enabled).toBe(false);
  });

  it('fails startup on any other value so a typo cannot silently change the job', () => {
    expect(() => loadPickupTicketJobConfig({ C48_PICKUP_TICKET_JOB_ENABLED: 'no' })).toThrow('C48_PICKUP_TICKET_JOB_ENABLED');
    expect(() => loadPickupTicketJobConfig({ C48_PICKUP_TICKET_JOB_ENABLED: 'FALSE' })).toThrow('C48_PICKUP_TICKET_JOB_ENABLED');
  });
});
