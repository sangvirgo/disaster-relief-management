import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { NeedNormPatchDto } from './needs.dto';
import { requireNeedNormManage } from './needs.helpers';
import type { NeedQuantityBasis } from './need-estimate';

interface NeedNormRow extends Record<string, unknown> {
  id: string;
  category: string;
  item_type_code: string;
  quantity_basis: NeedQuantityBasis;
  qty_adult: string;
  qty_child: string;
  qty_elderly: string;
  people_per_unit: number | string | null;
  fixed_quantity: string | null;
  default_item_id: string | null;
  in_default_bundle: boolean;
  active: boolean;
  version: number | string;
  updated_at: Date | string;
}

const selectNorm = `SELECT id,category,item_type_code,quantity_basis,qty_adult::text,qty_child::text,qty_elderly::text,
                           people_per_unit,fixed_quantity::text,default_item_id,in_default_bundle,active,version,updated_at
                      FROM need_norm`;

const nonZero = /[1-9]/u;

function normValue(row: NeedNormRow): Record<string, unknown> {
  const updatedAt = row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at);
  return {
    id: row.id,
    category: row.category,
    item_type_code: row.item_type_code,
    quantity_basis: row.quantity_basis,
    qty_adult: row.qty_adult,
    qty_child: row.qty_child,
    qty_elderly: row.qty_elderly,
    people_per_unit: row.people_per_unit === null ? null : Number(row.people_per_unit),
    fixed_quantity: row.fixed_quantity,
    default_item_id: row.default_item_id,
    in_default_bundle: row.in_default_bundle,
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

function shapeInvalid(): AppError {
  return new AppError('NEED_NORM_SHAPE_INVALID', { status: 400 });
}

/**
 * Checks a norm's final values against its quantity basis. Fields that do not apply to the basis must be absent or
 * cleared; fields that do apply must be present. The database CHECK repeats these rules as a last guard.
 */
function normShape(
  basis: NeedQuantityBasis,
  current: NeedNormRow,
  dto: NeedNormPatchDto,
): {
  qty_adult: string; qty_child: string; qty_elderly: string; people_per_unit: number | null; fixed_quantity: string | null;
} {
  const qty = {
    qty_adult: dto.qty_adult ?? current.qty_adult,
    qty_child: dto.qty_child ?? current.qty_child,
    qty_elderly: dto.qty_elderly ?? current.qty_elderly,
  };
  const ppu = dto.people_per_unit !== undefined ? dto.people_per_unit : (current.people_per_unit === null ? null : Number(current.people_per_unit));
  const fixed = dto.fixed_quantity !== undefined ? dto.fixed_quantity : current.fixed_quantity;
  const qtyProvidedNonZero = [dto.qty_adult, dto.qty_child, dto.qty_elderly].some((value) => value !== undefined && nonZero.test(value));

  if (basis === 'BY_GROUP') {
    if (dto.people_per_unit !== undefined && dto.people_per_unit !== null) throw shapeInvalid();
    if (dto.fixed_quantity !== undefined && dto.fixed_quantity !== null) throw shapeInvalid();
    if (![qty.qty_adult, qty.qty_child, qty.qty_elderly].some((value) => nonZero.test(value))) throw shapeInvalid();
    return { ...qty, people_per_unit: null, fixed_quantity: null };
  }
  if (basis === 'PER_N_PEOPLE') {
    if (qtyProvidedNonZero || (dto.fixed_quantity !== undefined && dto.fixed_quantity !== null)) throw shapeInvalid();
    if (ppu === null || ppu < 1) throw shapeInvalid();
    return { qty_adult: '0', qty_child: '0', qty_elderly: '0', people_per_unit: ppu, fixed_quantity: null };
  }
  // PER_REQUEST
  if (qtyProvidedNonZero || (dto.people_per_unit !== undefined && dto.people_per_unit !== null)) throw shapeInvalid();
  if (fixed === null || !nonZero.test(fixed)) throw shapeInvalid();
  return { qty_adult: '0', qty_child: '0', qty_elderly: '0', people_per_unit: null, fixed_quantity: fixed };
}

/** Manager-only maintenance of the need norm table used by SOS estimates. Changes are version-checked and audited. */
@Injectable()
export class NeedNormsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
  ) {}

  async list(request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    requireNeedNormManage(session.grants);
    const rows = await this.dataSource.query(`${selectNorm} ORDER BY category`) as NeedNormRow[];
    return { items: rows.map(normValue), generated_at: new Date().toISOString() };
  }

  async update(id: string, dto: NeedNormPatchDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    requireNeedNormManage(session.grants);
    const changed = Object.entries(dto).some(([key, value]) => key !== 'expected_version' && value !== undefined);
    if (!changed) throw new AppError('VALIDATION_FAILED', { status: 400 });

    return this.dataSource.transaction(async (manager) => {
      const current = await manager.query(`${selectNorm} WHERE id=$1 FOR UPDATE`, [id]) as NeedNormRow[];
      if (!current[0]) throw new AppError('NOT_FOUND', { status: 404 });
      if (Number(current[0].version) !== dto.expected_version) {
        throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(current[0].version) } });
      }
      const before = normValue(current[0]);
      const basis = dto.quantity_basis ?? current[0].quantity_basis;
      const shape = normShape(basis, current[0], dto);

      let defaultItemId = dto.default_item_id !== undefined ? dto.default_item_id : current[0].default_item_id;
      if (dto.default_item_id) {
        const items = await manager.query(
          'SELECT status,item_type_code FROM item WHERE id=$1 FOR SHARE',
          [dto.default_item_id],
        ) as Array<{ status: string; item_type_code: string }>;
        const item = items[0];
        if (!item || item.status !== 'ACTIVE' || item.item_type_code !== current[0].item_type_code) {
          throw new AppError('NEED_DEFAULT_ITEM_INVALID', { status: 400 });
        }
      }
      defaultItemId = defaultItemId ?? null;

      const updated = await manager.query(
        `UPDATE need_norm SET
            quantity_basis=$3,
            qty_adult=$4::numeric, qty_child=$5::numeric, qty_elderly=$6::numeric,
            people_per_unit=$7::integer, fixed_quantity=$8::numeric,
            default_item_id=$9::uuid,
            in_default_bundle=COALESCE($10::boolean,in_default_bundle),
            active=COALESCE($11::boolean,active),
            version=version+1, updated_at=now()
          WHERE id=$1 AND version=$2 RETURNING id`,
        [
          id, dto.expected_version, basis,
          shape.qty_adult, shape.qty_child, shape.qty_elderly,
          shape.people_per_unit, shape.fixed_quantity,
          defaultItemId,
          dto.in_default_bundle ?? null, dto.active ?? null,
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
