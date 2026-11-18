import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { NeedNormPatchDto } from './needs.dto';
import { requireNeedNormManage } from './needs.helpers';

interface NeedNormRow extends Record<string, unknown> {
  id: string;
  category: string;
  item_type_code: string;
  quantity_basis: 'PER_PERSON_DAY' | 'PER_PERSON';
  qty_per_person_per_day: string;
  modifier_infant: string;
  modifier_elderly: string;
  active: boolean;
  version: number | string;
  updated_at: Date | string;
}

const selectNorm = `SELECT id,category,item_type_code,quantity_basis,qty_per_person_per_day::text,
                           modifier_infant::text,modifier_elderly::text,active,version,updated_at
                      FROM need_norm`;

function normValue(row: NeedNormRow): Record<string, unknown> {
  const updatedAt = row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at);
  return {
    id: row.id,
    category: row.category,
    item_type_code: row.item_type_code,
    quantity_basis: row.quantity_basis,
    qty_per_person_per_day: row.qty_per_person_per_day,
    modifier_infant: row.modifier_infant,
    modifier_elderly: row.modifier_elderly,
    active: row.active,
    version: Number(row.version),
    updated_at: updatedAt.toISOString(),
  };
}

async function readNorm(manager: Pick<EntityManager, 'query'>, id: string): Promise<NeedNormRow> {
  const rows = await manager.query(`${selectNorm} WHERE id=$1`, [id]) as NeedNormRow[];
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return rows[0];
}

/** Manager-only maintenance of the per-person norm table used by need estimates. Changes are version-checked and audited. */
@Injectable()
export class NeedNormsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
  ) {}

  async list(request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    requireNeedNormManage(session.grants);
    const rows = await this.dataSource.query(`${selectNorm} ORDER BY category,item_type_code`) as NeedNormRow[];
    return { items: rows.map(normValue), generated_at: new Date().toISOString() };
  }

  async update(id: string, dto: NeedNormPatchDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    requireNeedNormManage(session.grants);
    const changes = [dto.qty_per_person_per_day, dto.modifier_infant, dto.modifier_elderly, dto.quantity_basis, dto.active];
    if (changes.every((value) => value === undefined)) throw new AppError('VALIDATION_FAILED', { status: 400 });
    if (dto.qty_per_person_per_day !== undefined && !/[1-9]/u.test(dto.qty_per_person_per_day)) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }

    return this.dataSource.transaction(async (manager) => {
      const current = await manager.query(`${selectNorm} WHERE id=$1 FOR UPDATE`, [id]) as NeedNormRow[];
      if (!current[0]) throw new AppError('NOT_FOUND', { status: 404 });
      if (Number(current[0].version) !== dto.expected_version) {
        throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(current[0].version) } });
      }
      const before = normValue(current[0]);
      const updated = await manager.query(
        `UPDATE need_norm SET
            qty_per_person_per_day=COALESCE($3::numeric,qty_per_person_per_day),
            modifier_infant=COALESCE($4::numeric,modifier_infant),
            modifier_elderly=COALESCE($5::numeric,modifier_elderly),
            quantity_basis=COALESCE($6,quantity_basis),
            active=COALESCE($7::boolean,active),
            version=version+1,updated_at=now()
          WHERE id=$1 AND version=$2 RETURNING id`,
        [
          id, dto.expected_version,
          dto.qty_per_person_per_day ?? null, dto.modifier_infant ?? null, dto.modifier_elderly ?? null,
          dto.quantity_basis ?? null, dto.active ?? null,
        ],
      ) as Array<{ id: string }>;
      if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
      const value = normValue(await readNorm(manager, id));
      await manager.query(
        `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state,reason)
         VALUES ($1,'NEED_NORM_UPDATED','need_norm',$2,$3::jsonb,$4::jsonb,NULL)`,
        [session.userId, id, JSON.stringify(before), JSON.stringify(value)],
      );
      return value;
    });
  }
}
