import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { timeLabel } from '../../i18n/labels';
import {
  assignmentFlagLabels,
  assignmentFlagTones,
  campaignWarehouseRoleLabels,
  campaignWarehouseSourceLabels,
  labelFor,
} from '../../i18n/supplyLabels';
import { distanceLabel, type CampaignWarehouseRow, type CampaignWarehouseView } from '../supply-gaps/supplyModel';
import '../supply-gaps/supply-gaps.css';

type Named = { id?: string; name?: string };

/**
 * Campaign warehouse assignment. Everyone with CAMPAIGN_WAREHOUSE_VIEW sees it read-only.
 * `canManage` (OPERATIONS_MANAGER only) adds the change-primary and re-evaluate actions; the backend enforces them too.
 */
export function CampaignWarehousePanel({ campaignId, canManage }: { campaignId: string; canManage: boolean }) {
  const [view, setView] = useState<CampaignWarehouseView | null>(null);
  const [warehouseNames, setWarehouseNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<'primary' | 'reevaluate' | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api<CampaignWarehouseView>('logistics', `/campaigns/${encodeURIComponent(campaignId)}/warehouses`)
      .then((value) => { if (live) setView(value); })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải kho phục vụ.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [campaignId, revision]);

  // Warehouse names are a bounded catalog lookup; the view itself already carries the names of eligible warehouses.
  useEffect(() => {
    let live = true;
    fetchAll<Named>('logistics', '/warehouses')
      .then((rows) => { if (live) setWarehouseNames(new Map(rows.filter((row) => row.id).map((row) => [row.id!, row.name || '']))); })
      .catch(() => { if (live) setWarehouseNames(new Map()); });
    return () => { live = false; };
  }, []);

  function reload(message: string) {
    setAction(null);
    setNotice(message);
    setRevision((value) => value + 1);
  }

  const nameOf = (warehouseId: string) => {
    const eligible = view?.warehouses.find((row) => row.warehouse_id === warehouseId);
    return eligible?.name || warehouseNames.get(warehouseId) || `Kho mã …${warehouseId.slice(-8)}`;
  };
  const eligibleRows = view?.warehouses.filter((row) => row.eligible) ?? [];

  const primarySpec = (current: CampaignWarehouseView): CommandSpec => ({
    title: 'Đổi kho chính',
    service: 'logistics',
    method: 'PUT',
    path: `/campaigns/${encodeURIComponent(campaignId)}/primary-warehouse`,
    version: current.assignment_version,
    warning: 'Xác nhận đổi kho chính của chiến dịch? Thao tác và lý do sẽ được ghi vào nhật ký.',
    fields: [
      {
        name: 'warehouse_id',
        label: 'Kho chính mới (chỉ kho đủ điều kiện)',
        type: 'select',
        required: true,
        emptyLabel: 'Chọn kho',
        options: eligibleRows.map((row) => ({ value: row.warehouse_id, label: `${row.name} · ${distanceLabel(row.distance_m)}` })),
      },
      { name: 'reason', label: 'Lý do đổi kho chính', type: 'textarea', required: true, maxLength: 500 },
    ],
    build: (values) => ({ warehouse_id: values.warehouse_id, reason: values.reason }),
  });

  const reevaluateSpec: CommandSpec = {
    title: 'Tính lại kho phục vụ',
    service: 'logistics',
    path: `/campaigns/${encodeURIComponent(campaignId)}/warehouses/reevaluate`,
    warning: 'Xác nhận tính lại kho phục vụ cho chiến dịch này?',
    fields: [
      {
        name: 'clear_manual',
        label: 'Cách xử lý kho chọn thủ công',
        type: 'select',
        required: true,
        options: [
          { value: 'false', label: 'Giữ kho chọn thủ công nếu còn đủ điều kiện' },
          { value: 'true', label: 'Bỏ kho chọn thủ công và tính lại tự động' },
        ],
        initialValue: 'false',
      },
    ],
    build: (values) => ({ clear_manual: values.clear_manual === 'true' }),
  };

  return (
    <section className="campaign-warehouse-panel" aria-labelledby={`campaign-warehouse-title-${campaignId}`}>
      <h3 id={`campaign-warehouse-title-${campaignId}`}>Kho phục vụ chiến dịch</h3>
      {notice && <p className="notice" role="status">{notice}</p>}
      {loading && <Skeleton rows={2} label="Đang tải kho phục vụ…" />}
      {error && <p className="notice error" role="alert">{error}</p>}
      {view && !loading && (
        <>
          <p className="muted">Tải lúc {timeLabel(view.generated_at)}. Kho dự phòng chỉ để tham khảo; hệ thống không tự chuyển hàng.</p>
          <dl className="fact-list">
            <div>
              <dt>Vùng phục vụ</dt>
              <dd>{view.area ? `Tâm ${view.area.center.lat}, ${view.area.center.lng} · bán kính ${Math.round(view.area.radius_m).toLocaleString('vi-VN')} m` : 'Chưa có vùng phục vụ'}</dd>
            </div>
            <div>
              <dt>Kho chính</dt>
              <dd>
                {view.primary
                  ? <>
                    {nameOf(view.primary.warehouse_id)} · {labelFor(campaignWarehouseSourceLabels, view.primary.source, 'Chưa rõ nguồn')}
                    {!view.primary.eligible && <> · không còn đủ điều kiện phục vụ</>}
                  </>
                  : view.proposed_primary_warehouse_id
                    ? <>Chưa lưu kho chính. Đề xuất hiện tại: {nameOf(view.proposed_primary_warehouse_id)}</>
                    : 'Chưa có kho chính nào đủ điều kiện'}
              </dd>
            </div>
          </dl>

          {view.flags.length > 0 && (
            <ul className="supply-flag-list" aria-label="Cảnh báo kho phục vụ">
              {view.flags.map((flag) => (
                <li key={flag}>
                  <Badge tone={labelFor(assignmentFlagTones, flag, 'warning') as BadgeTone} kind="meta">
                    {labelFor(assignmentFlagLabels, flag, 'Có cảnh báo về kho phục vụ.')}
                  </Badge>
                </li>
              ))}
            </ul>
          )}

          {view.warehouses.length === 0 && !view.flags.includes('CAMPAIGN_AREA_MISSING') && (
            <p className="muted">Chưa có kho nào đủ điều kiện phục vụ.</p>
          )}
          {view.warehouses.length > 0 && (
            <div className="operations-table-scroll" role="region" aria-label="Bảng kho phục vụ chiến dịch" tabIndex={0}>
              <table className="operations-record-table supply-warehouse-table">
                <thead>
                  <tr>
                    <th scope="col">Kho</th>
                    <th scope="col">Vai trò</th>
                    <th scope="col">Nguồn gán</th>
                    <th scope="col">Khoảng cách</th>
                    <th scope="col">Nhu cầu có tồn kho</th>
                    <th scope="col">Phiếu phân phối mở</th>
                  </tr>
                </thead>
                <tbody>
                  {view.warehouses.map((row) => <WarehouseRow key={row.warehouse_id} row={row} />)}
                </tbody>
              </table>
            </div>
          )}

          {!canManage && <p className="muted">Bạn chỉ xem được kho phục vụ. Quản lý vận hành thay đổi kho chính.</p>}
          {canManage && (
            <div className="supply-action-row">
              <button type="button" className="button primary" aria-expanded={action === 'primary'} disabled={!eligibleRows.length}
                onClick={() => setAction(action === 'primary' ? null : 'primary')}>
                Đổi kho chính
              </button>
              <button type="button" className="button secondary" aria-expanded={action === 'reevaluate'}
                onClick={() => setAction(action === 'reevaluate' ? null : 'reevaluate')}>
                Tính lại kho
              </button>
            </div>
          )}
          {canManage && action === 'primary' && (
            <CommandForm
              key={`primary-${view.assignment_version}`}
              spec={primarySpec(view)}
              onSuccess={() => reload('Đã đổi kho chính của chiến dịch.')}
              onStale={() => reload('Kho phục vụ đã thay đổi. Dữ liệu đã được tải lại; hãy kiểm tra trước khi đổi.')}
            />
          )}
          {canManage && action === 'reevaluate' && (
            <CommandForm
              key={`reevaluate-${view.assignment_version}`}
              spec={reevaluateSpec}
              onSuccess={() => reload('Đã tính lại kho phục vụ.')}
              onStale={() => reload('Kho phục vụ đã thay đổi. Dữ liệu đã được tải lại.')}
            />
          )}
        </>
      )}
    </section>
  );
}

function WarehouseRow({ row }: { row: CampaignWarehouseRow }) {
  return (
    <tr>
      <th scope="row">{row.name}{!row.eligible && <small className="muted"> · không còn đủ điều kiện</small>}</th>
      <td>{labelFor(campaignWarehouseRoleLabels, row.role, 'Chưa gán')}</td>
      <td>{labelFor(campaignWarehouseSourceLabels, row.source, '—')}</td>
      <td>{distanceLabel(row.distance_m)}</td>
      <td>Có tồn cho {row.stock.needed_items_in_stock} / {row.stock.open_needed_items} mặt hàng đang cần</td>
      <td>{row.open_distributions}</td>
    </tr>
  );
}
