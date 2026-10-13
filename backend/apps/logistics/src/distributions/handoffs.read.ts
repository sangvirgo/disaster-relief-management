import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { decimalFromUnits, quantityUnits } from '../common/quantity';

type Queryable = Pick<DataSource | EntityManager, 'query'>;

interface HandoffRow {
  id: string;
  distribution_id: string;
  handoff_kind: string;
  source_stage: string | null;
  receiver_user_id: string | null;
  receiver_label: string | null;
  recorder_user_id: string;
  confirmation_basis: string;
  occurred_at: Date | string;
  created_at: Date | string;
  decision: 'APPROVE' | 'REJECT' | null;
  reviewer_user_id: string | null;
  reason: string | null;
}

export async function readHandoffView(source: Queryable, distributionId: string, handoffId: string): Promise<Record<string, unknown>> {
  const rows = await source.query(
    `SELECT h.id,h.distribution_id,h.handoff_kind,h.source_stage,h.receiver_user_id,h.receiver_label,
            h.recorder_user_id,h.confirmation_basis,h.occurred_at,h.created_at,
            r.decision,r.reviewer_user_id,r.reason
       FROM handoff_record h LEFT JOIN handoff_loss_review r ON r.handoff_id=h.id
      WHERE h.distribution_id=$1 AND h.id=$2`,
    [distributionId, handoffId],
  ) as HandoffRow[];
  const handoff = rows[0];
  if (!handoff) throw new AppError('NOT_FOUND', { status: 404 });
  const lineRows = await source.query(
    `SELECT hl.id,hl.distribution_line_id,hl.commitment_id,hl.quantity::text,i.unit_code,u.scale AS unit_scale
       FROM handoff_line hl JOIN distribution_line dl ON dl.id=hl.distribution_line_id
       JOIN item i ON i.id=dl.item_id JOIN unit u ON u.code=i.unit_code
      WHERE hl.handoff_id=$1 ORDER BY hl.distribution_line_id`,
    [handoffId],
  ) as Array<{ id: string; distribution_line_id: string; commitment_id: string | null; quantity: string; unit_code: string; unit_scale: number }>;

  return {
    id: handoff.id,
    distribution_id: handoff.distribution_id,
    handoff_kind: handoff.handoff_kind,
    source_stage: handoff.source_stage,
    receiver_user_id: handoff.receiver_user_id,
    receiver_label: handoff.receiver_label,
    recorder_user_id: handoff.recorder_user_id,
    confirmation_basis: handoff.confirmation_basis,
    occurred_at: new Date(handoff.occurred_at).toISOString(),
    created_at: new Date(handoff.created_at).toISOString(),
    version: 1,
    status: handoff.handoff_kind === 'LOSS'
      ? handoff.decision === 'APPROVE' ? 'APPROVED' : handoff.decision === 'REJECT' ? 'REJECTED' : 'PENDING_LOSS'
      : 'RECORDED',
    review: handoff.decision ? {
      decision: handoff.decision,
      reviewer_user_id: handoff.reviewer_user_id,
      reason: handoff.reason,
    } : null,
    lines: lineRows.map((line) => ({
      id: line.id,
      distribution_line_id: line.distribution_line_id,
      commitment_id: line.commitment_id,
      quantity: decimalFromUnits(quantityUnits(line.quantity, Number(line.unit_scale)), Number(line.unit_scale)),
      unit_code: line.unit_code,
    })),
  };
}
