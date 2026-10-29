import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { ReceiptLineFacts, receiptLineFlags } from './donation-receipts.helpers';

type Queryable = Pick<DataSource | EntityManager, 'query'>;

interface ReceiptRow extends Record<string, unknown> {
  id: string;
  delivery_id: string;
  organization_id: string;
  region_code: string;
  version: number | string;
  created_at: Date | string;
  count_revision: number | null;
  declaration_revision: number | null;
  count_note: string | null;
}

const lineSql = `
  WITH current_declaration AS (
    SELECT dl.item_id,dl.declared_quantity::text AS declared_quantity
      FROM donation_declaration dd JOIN donation_line dl ON dl.delivery_id=dd.delivery_id AND dl.revision=dd.revision
     WHERE dd.delivery_id=$1 AND dd.revision=(SELECT max(revision) FROM donation_declaration WHERE delivery_id=$1)
  ), current_count AS (
    SELECT rcl.item_id,rcl.counted_quantity::text AS counted_quantity,rcl.accepted_quantity::text AS accepted_quantity,
           rcl.held_quantity::text AS held_quantity,rcl.rejected_quantity::text AS rejected_quantity,
           rcl.condition_note,rcl.expiry_date
      FROM receipt_count rc JOIN receipt_count_line rcl ON rcl.receipt_id=rc.receipt_id AND rcl.revision=rc.revision
     WHERE rc.receipt_id=$2 AND rc.revision=COALESCE($3::integer,(SELECT max(revision) FROM receipt_count WHERE receipt_id=$2))
  )
  SELECT COALESCE(cc.item_id,cd.item_id) AS item_id,i.name AS item_name,u.code AS unit_code,u.display_name AS unit_name,u.scale AS unit_scale,
         cd.declared_quantity,COALESCE(cc.counted_quantity,'0') AS counted_quantity,
         COALESCE(cc.accepted_quantity,'0') AS accepted_quantity,COALESCE(cc.held_quantity,'0') AS held_quantity,
         COALESCE(cc.rejected_quantity,'0') AS rejected_quantity,cc.condition_note,cc.expiry_date,
         (cc.item_id IS NOT NULL) AS has_count_line
    FROM current_declaration cd FULL OUTER JOIN current_count cc ON cc.item_id=cd.item_id
    JOIN item i ON i.id=COALESCE(cc.item_id,cd.item_id) JOIN unit u ON u.code=i.unit_code
   ORDER BY i.name,COALESCE(cc.item_id,cd.item_id)`;

export async function readReceiptView(query: Queryable, id: string): Promise<{
  organization_id: string;
  region_code: string;
  value: Record<string, unknown>;
}> {
  const rows = await query.query(
    `SELECT r.id,r.delivery_id,r.warehouse_id,r.version,r.created_at,
            dd.public_code,dd.donor_name,dd.donor_phone,dd.status AS delivery_status,dd.drive_id,d.title AS drive_title,
            w.organization_id,w.region_code,w.name AS warehouse_name,
            (SELECT max(revision) FROM receipt_count WHERE receipt_id=r.id) AS count_revision,
            (SELECT max(revision) FROM donation_declaration WHERE delivery_id=r.delivery_id) AS declaration_revision,
            (SELECT note FROM receipt_count WHERE receipt_id=r.id ORDER BY revision DESC LIMIT 1) AS count_note
       FROM donation_receipt r JOIN donation_delivery dd ON dd.id=r.delivery_id
       JOIN donation_drive d ON d.id=dd.drive_id JOIN warehouse w ON w.id=r.warehouse_id WHERE r.id=$1`,
    [id],
  ) as ReceiptRow[];
  const receipt = rows[0];
  if (!receipt) throw new AppError('NOT_FOUND', { status: 404 });
  const lines = receipt.count_revision === null ? [] : await readReceiptLines(query, receipt.delivery_id, id);
  const review = receipt.count_revision === null ? null : await readCurrentReview(
    query, id, Number(receipt.count_revision), Number(receipt.declaration_revision),
  );
  const {
    organization_id, region_code, count_revision: countRevision, declaration_revision: declarationRevision, count_note: countNote,
    ...value
  } = receipt;
  return {
    organization_id,
    region_code,
    value: {
      ...value,
      version: Number(receipt.version),
      created_at: new Date(receipt.created_at).toISOString(),
      delivery: {
        id: receipt.delivery_id,
        drive_id: receipt.drive_id,
        drive_title: receipt.drive_title,
        public_code: receipt.public_code,
        donor_name: receipt.donor_name,
        donor_phone: receipt.donor_phone,
        status: receipt.delivery_status,
      },
      count: countRevision === null ? null : {
        revision: Number(countRevision),
        declaration_revision: Number(declarationRevision),
        note: countNote,
        lines,
      },
      review,
    },
  };
}

export async function readReceiptLines(
  query: Queryable,
  deliveryId: string,
  receiptId: string,
  countRevision?: number,
): Promise<Array<Record<string, unknown>>> {
  const rows = await query.query(lineSql, [deliveryId, receiptId, countRevision ?? null]) as Array<ReceiptLineFacts & Record<string, unknown>>;
  return rows.map(({ unit_scale: _scale, has_count_line: _hasCount, ...line }) => ({
    ...line,
    ...(line.expiry_date ? { expiry_date: new Date(line.expiry_date as Date | string).toISOString().slice(0, 10) } : {}),
    flags: receiptLineFlags({ ...line, unit_scale: Number(_scale), has_count_line: Boolean(_hasCount) } as ReceiptLineFacts),
  }));
}

async function readCurrentReview(
  query: Queryable,
  receiptId: string,
  countRevision: number,
  declarationRevision: number,
): Promise<Record<string, unknown> | null> {
  const rows = await query.query(
    `SELECT decision,reason,reviewed_at FROM receipt_review
      WHERE receipt_id=$1 AND count_revision=$2 AND declaration_revision=$3 ORDER BY reviewed_at DESC,id DESC LIMIT 1`,
    [receiptId, countRevision, declarationRevision],
  ) as Array<{ decision: string; reason: string | null; reviewed_at: Date | string }>;
  const review = rows[0];
  return review ? { ...review, reviewed_at: new Date(review.reviewed_at).toISOString() } : null;
}
