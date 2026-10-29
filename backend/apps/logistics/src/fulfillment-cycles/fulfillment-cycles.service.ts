import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { ResponseCycleIntentClient } from '../integrations/response/response-cycle-intent.client';
import type { ResolutionOutcomeBasis, ResponseCycleIntent } from '../integrations/response/response-cycle-intent.client';
import { CycleIntentDto, SealCycleDto } from './fulfillment-cycles.dto';

type CycleState = 'OPEN' | 'FROZEN' | 'SEALED';
type IntentKind = 'RESOLUTION' | 'CANCELLATION';
type IntentState = 'SEALED' | 'FROZEN' | 'ABORTED';
type CycleCommand = 'freeze' | 'seal' | 'unseal';

interface FulfillmentCycleRow {
  id: string;
  request_id: string;
  work_cycle: number;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
  state: CycleState;
}

interface CycleIntentRow {
  intent_id: string;
  cycle_id: string;
  kind: IntentKind;
  state: IntentState;
}

interface CycleSettlement {
  has_open_needs: boolean;
  has_reserved: boolean;
  has_unsettled_issued: boolean;
  has_delivered: boolean;
}

const outcomeBases = new Set<ResolutionOutcomeBasis>(['RESCUE_COMPLETED', 'SUPPLY_ONLY', 'NO_ACTION_REQUIRED']);

function invalidTransition(): AppError {
  return new AppError('STATE_TRANSITION_INVALID', { status: 409 });
}

function invalidInput(): AppError {
  return new AppError('VALIDATION_FAILED', { status: 400 });
}

function sameAttribution(cycle: FulfillmentCycleRow, intent: ResponseCycleIntent): boolean {
  return cycle.request_id === intent.request_id && Number(cycle.work_cycle) === intent.work_cycle &&
    cycle.organization_id === intent.organization_id && cycle.region_code === intent.region_code &&
    cycle.campaign_id === intent.campaign_id;
}

@Injectable()
export class FulfillmentCyclesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly response: ResponseCycleIntentClient,
  ) {}

  freeze(requestId: string, workCycle: number, dto: CycleIntentDto): Promise<Record<string, unknown>> {
    return this.execute('freeze', requestId, workCycle, dto);
  }

  seal(requestId: string, workCycle: number, dto: SealCycleDto): Promise<Record<string, unknown>> {
    return this.execute('seal', requestId, workCycle, dto);
  }

  unseal(requestId: string, workCycle: number, dto: CycleIntentDto): Promise<Record<string, unknown>> {
    return this.execute('unseal', requestId, workCycle, dto);
  }

  private async execute(
    command: CycleCommand,
    requestId: string,
    workCycle: number,
    dto: CycleIntentDto | SealCycleDto,
  ): Promise<Record<string, unknown>> {
    if (!Number.isSafeInteger(workCycle) || workCycle < 1 || !dto?.intent_id) throw invalidInput();

    // The cross-service check must finish before a Logistics transaction starts.
    const intent = await this.response.getIntent(dto.intent_id);
    this.assertRemoteIntent(command, requestId, workCycle, dto, intent);

    return this.dataSource.transaction((manager) => this.executeLocked(manager, command, intent, dto));
  }

  private assertRemoteIntent(
    command: CycleCommand,
    requestId: string,
    workCycle: number,
    dto: CycleIntentDto | SealCycleDto,
    intent: ResponseCycleIntent,
  ): void {
    if (intent.id !== dto.intent_id || intent.request_id !== requestId || intent.work_cycle !== workCycle) throw invalidTransition();

    if (command === 'freeze') {
      if (intent.kind !== 'CANCELLATION' || intent.state !== 'PENDING') throw invalidTransition();
      return;
    }

    if (command === 'seal') {
      const sealDto = dto as SealCycleDto;
      if (intent.kind !== 'RESOLUTION' || intent.state !== 'PENDING' ||
          !outcomeBases.has(sealDto.outcome_basis) || intent.outcome_basis !== sealDto.outcome_basis) {
        throw invalidTransition();
      }
      return;
    }

    if (intent.state !== 'ABORTING' || intent.request_status === 'RESOLVED' || intent.request_status === 'CLOSED') {
      throw invalidTransition();
    }
  }

  private async executeLocked(
    manager: EntityManager,
    command: CycleCommand,
    intent: ResponseCycleIntent,
    dto: CycleIntentDto | SealCycleDto,
  ): Promise<Record<string, unknown>> {
    const cycle = await this.lockCycle(manager, intent);
    const sameIntent = await this.lockIntent(manager, intent.id);
    const liveIntent = await this.lockLiveIntent(manager, cycle.id);

    if (command === 'unseal') return this.unsealLocked(manager, cycle, sameIntent, liveIntent, intent);

    const expectedKind = command === 'seal' ? 'RESOLUTION' : 'CANCELLATION';
    const expectedIntentState: IntentState = command === 'seal' ? 'SEALED' : 'FROZEN';
    const expectedCycleState: CycleState = command === 'seal' ? 'SEALED' : 'FROZEN';
    if (sameIntent) {
      if (sameIntent.cycle_id === cycle.id && sameIntent.kind === expectedKind && sameIntent.state === expectedIntentState &&
          liveIntent?.intent_id === intent.id && cycle.state === expectedCycleState) {
        return this.result(intent, expectedCycleState);
      }
      throw invalidTransition();
    }
    if (liveIntent) throw invalidTransition();
    this.assertCycleCanTransition(cycle);

    if (command === 'seal') await this.assertSettled(manager, cycle.id, (dto as SealCycleDto).outcome_basis);

    await manager.query(
      `INSERT INTO cycle_intent (intent_id,cycle_id,kind,state)
       VALUES ($1,$2,$3,$4)`,
      [intent.id, cycle.id, expectedKind, expectedIntentState],
    );
    await manager.query('UPDATE fulfillment_cycle SET state=$2 WHERE id=$1', [cycle.id, expectedCycleState]);
    return this.result(intent, expectedCycleState);
  }

  private async unsealLocked(
    manager: EntityManager,
    cycle: FulfillmentCycleRow,
    sameIntent: CycleIntentRow | null,
    liveIntent: CycleIntentRow | null,
    intent: ResponseCycleIntent,
  ): Promise<Record<string, unknown>> {
    if (sameIntent && (sameIntent.cycle_id !== cycle.id || sameIntent.kind !== intent.kind)) throw invalidTransition();
    if (liveIntent && liveIntent.intent_id !== intent.id) throw invalidTransition();

    if (sameIntent?.state === 'ABORTED') {
      if (liveIntent || cycle.state !== 'OPEN') throw invalidTransition();
      return this.result(intent, 'OPEN');
    }

    if (liveIntent?.intent_id === intent.id) {
      const boundState = intent.kind === 'RESOLUTION' ? 'SEALED' : 'FROZEN';
      const boundCycleState: CycleState = intent.kind === 'RESOLUTION' ? 'SEALED' : 'FROZEN';
      if (liveIntent.kind !== intent.kind || liveIntent.state !== boundState || cycle.state !== boundCycleState) throw invalidTransition();
      await manager.query("UPDATE cycle_intent SET state='ABORTED' WHERE intent_id=$1 AND state <> 'ABORTED'", [intent.id]);
      await manager.query("UPDATE fulfillment_cycle SET state='OPEN' WHERE id=$1", [cycle.id]);
      return this.result(intent, 'OPEN');
    }

    if (cycle.state !== 'OPEN') throw invalidTransition();
    await manager.query(
      `INSERT INTO cycle_intent (intent_id,cycle_id,kind,state)
       VALUES ($1,$2,$3,'ABORTED')`,
      [intent.id, cycle.id, intent.kind],
    );
    return this.result(intent, 'OPEN');
  }

  private async lockCycle(manager: EntityManager, intent: ResponseCycleIntent): Promise<FulfillmentCycleRow> {
    await manager.query(
      `INSERT INTO fulfillment_cycle (request_id,work_cycle,organization_id,campaign_id,region_code)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (request_id,work_cycle) DO NOTHING`,
      [intent.request_id, intent.work_cycle, intent.organization_id, intent.campaign_id, intent.region_code],
    );
    const rows = await manager.query(
      `SELECT id,request_id,work_cycle,organization_id,region_code,campaign_id,state
         FROM fulfillment_cycle WHERE request_id=$1 AND work_cycle=$2 FOR UPDATE`,
      [intent.request_id, intent.work_cycle],
    ) as FulfillmentCycleRow[];
    const cycle = rows[0];
    if (!cycle || !sameAttribution(cycle, intent)) throw new AppError('INTERNAL_ERROR', { status: 500 });
    return cycle;
  }

  private async lockIntent(manager: EntityManager, intentId: string): Promise<CycleIntentRow | null> {
    const rows = await manager.query(
      `SELECT intent_id,cycle_id,kind,state FROM cycle_intent WHERE intent_id=$1 FOR UPDATE`,
      [intentId],
    ) as CycleIntentRow[];
    return rows[0] ?? null;
  }

  private async lockLiveIntent(manager: EntityManager, cycleId: string): Promise<CycleIntentRow | null> {
    const rows = await manager.query(
      `SELECT intent_id,cycle_id,kind,state FROM cycle_intent WHERE cycle_id=$1 AND state <> 'ABORTED' FOR UPDATE`,
      [cycleId],
    ) as CycleIntentRow[];
    return rows[0] ?? null;
  }

  private assertCycleCanTransition(cycle: FulfillmentCycleRow): void {
    if (cycle.state === 'OPEN') return;
    if (cycle.state === 'FROZEN') throw new AppError('CYCLE_FROZEN', { status: 409 });
    if (cycle.state === 'SEALED') throw new AppError('CYCLE_SEALED', { status: 409 });
    throw invalidTransition();
  }

  private async assertSettled(manager: EntityManager, cycleId: string, basis: ResolutionOutcomeBasis): Promise<void> {
    const rows = await manager.query(
      `SELECT
         EXISTS (SELECT 1 FROM relief_need n WHERE n.cycle_id=$1 AND n.status IN ('OPEN','PARTIALLY_FULFILLED')) AS has_open_needs,
         EXISTS (SELECT 1 FROM commitment cm JOIN relief_need n ON n.id=cm.relief_need_id
                  WHERE n.cycle_id=$1 AND cm.quantity-cm.released_quantity-cm.issued_quantity>0) AS has_reserved,
         EXISTS (SELECT 1 FROM commitment cm JOIN relief_need n ON n.id=cm.relief_need_id
                  WHERE n.cycle_id=$1 AND cm.issued_quantity-cm.delivered_quantity-cm.returned_quantity-cm.lost_quantity>0) AS has_unsettled_issued,
         EXISTS (SELECT 1 FROM commitment cm JOIN relief_need n ON n.id=cm.relief_need_id
                  WHERE n.cycle_id=$1 AND cm.delivered_quantity>0) AS has_delivered`,
      [cycleId],
    ) as CycleSettlement[];
    const settlement = rows[0];
    if (!settlement) throw new AppError('INTERNAL_ERROR', { status: 500 });

    const reasons: string[] = [];
    if (settlement.has_open_needs) reasons.push('OPEN_NEED');
    if (settlement.has_reserved) reasons.push('RESERVED_QUANTITY');
    if (settlement.has_unsettled_issued) reasons.push('UNSETTLED_ISSUE');
    if (basis === 'SUPPLY_ONLY' && !settlement.has_delivered) reasons.push('NO_DELIVERED_AID');
    if (basis === 'NO_ACTION_REQUIRED' && settlement.has_delivered) reasons.push('DELIVERED_AID_PRESENT');
    if (reasons.length) throw new AppError('CYCLE_NOT_SETTLED', { status: 409, details: { reasons } });
  }

  private result(intent: ResponseCycleIntent, cycleState: CycleState): Record<string, unknown> {
    return { intent_id: intent.id, request_id: intent.request_id, work_cycle: intent.work_cycle, cycle_state: cycleState };
  }
}
