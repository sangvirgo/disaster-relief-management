import { Dropdown } from '../../components/ui/Dropdown';
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';
import { LIST_PAGE_SIZE, useCursorNav } from '../../api/useCursorNav';
import { roles, type Me } from '../../auth/session';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { DetailSurface } from '../../components/DetailSurface';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { ListNav } from '../../components/ui/Pager';
import { Skeleton } from '../../components/ui/Skeleton';
import { dateLabel, timeLabel } from '../../i18n/labels';
import { formatQuantity } from '../../i18n/quantity';
import { labelFor, severityDescriptions, supplyGapStatusLabels, supplyGapStatusOptions, supplyGapStatusTones } from '../../i18n/supplyLabels';
import {
  canAcceptSupplyGap,
  canDismissSupplyGap,
  canManageSupplyGaps,
  isoToLocalInput,
  type SupplyGap,
  type SupplyGapList,
} from './supplyModel';
import { SeverityBadge } from './SupplyBadges';

type Named = { id?: string; name?: string; title?: string; unit?: { display_name?: string } | null };
type StockRow = { item_id?: string; available?: string; warehouse_id?: string };
type Refs = {
  campaigns: Map<string, string>;
  warehouses: Map<string, string>;
  unitByItem: Map<string, string>;
};

const shortId = (id: string) => `…${id.slice(-8)}`;
const quantityText = (value: unknown, unit: string) => `${formatQuantity(value)} ${unit || '(chưa rõ đơn vị)'}`;

/** Manager inbox for supply gap suggestions. Accept and dismiss are shown only to OPERATIONS_MANAGER. */
export function SupplyGapInbox({ user }: { user: Me }) {
  const canManage = canManageSupplyGaps(roles(user));
  const [status, setStatus] = useState('OPEN');
  const [items, setItems] = useState<SupplyGap[]>([]);
  const [cursor, setCursor, prevPage, pageIndex] = useCursorNav<string>('');
  const [next, setNext] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const [refs, setRefs] = useState<Refs>({ campaigns: new Map(), warehouses: new Map(), unitByItem: new Map() });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupplyGap | null>(null);
  const [detailError, setDetailError] = useState('');
  const [backupStock, setBackupStock] = useState<Map<string, string>>(new Map());
  const [action, setAction] = useState<'accept' | 'dismiss' | null>(null);

  // Catalog names are bounded lookups. A failed lookup only changes the display text, never the data.
  useEffect(() => {
    let live = true;
    void Promise.allSettled([
      fetchAll<Named>('response', '/campaigns'),
      fetchAll<Named>('logistics', '/warehouses'),
      fetchAll<Named>('logistics', '/items'),
    ]).then(([campaigns, warehouses, itemList]) => {
      if (!live) return;
      const named = (result: PromiseSettledResult<Named[]>, pick: (row: Named) => string) =>
        result.status === 'fulfilled' ? new Map(result.value.filter((row) => row.id).map((row) => [row.id!, pick(row)])) : new Map<string, string>();
      setRefs({
        campaigns: named(campaigns, (row) => row.name || row.title || ''),
        warehouses: named(warehouses, (row) => row.name || ''),
        unitByItem: itemList.status === 'fulfilled'
          ? new Map(itemList.value.filter((row) => row.id).map((row) => [row.id!, row.unit?.display_name || '']))
          : new Map(),
      });
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api<SupplyGapList>('logistics', `/supply-gaps?status=${encodeURIComponent(status)}&limit=${LIST_PAGE_SIZE * 2}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      .then((value) => {
        if (!live) return;
        setItems(value.items || []);
        setNext(value.more ? value.cursor || '' : '');
      })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải đề xuất quyên góp.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [status, cursor, revision]);

  // The detail is re-read so accept and dismiss always use the current version.
  useEffect(() => {
    if (!selectedId) { setDetail(null); setBackupStock(new Map()); return; }
    let live = true;
    setDetail(null);
    setDetailError('');
    api<SupplyGap>('logistics', `/supply-gaps/${selectedId}`)
      .then((value) => { if (live) setDetail(value); })
      .catch((cause) => { if (live) setDetailError(cause instanceof Error ? cause.message : 'Không thể tải chi tiết đề xuất.'); });
    return () => { live = false; };
  }, [selectedId, revision]);

  // Backup stock is informational. Nothing is transferred from a backup warehouse automatically.
  useEffect(() => {
    if (!detail?.backup_warehouse_ids.length) { setBackupStock(new Map()); return; }
    let live = true;
    void Promise.allSettled(detail.backup_warehouse_ids.map((warehouseId) =>
      fetchAll<StockRow>('logistics', `/stock?warehouse_id=${encodeURIComponent(warehouseId)}`)
        .then((rows) => [warehouseId, rows.find((row) => row.item_id === detail.item_id)?.available ?? '0'] as const))
    ).then((results) => {
      if (!live) return;
      setBackupStock(new Map(results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])));
    });
    return () => { live = false; };
  }, [detail?.id, detail?.backup_warehouse_ids.join(','), detail?.item_id]);

  function reloadAfterChange(message: string) {
    setAction(null);
    setNotice(message);
    setRevision((value) => value + 1);
  }

  function changeStatus(value: string) {
    setStatus(value);
    setCursor('');
    setNotice('');
  }

  const unitFor = (gap: SupplyGap) => refs.unitByItem.get(gap.item_id) || '';
  const campaignName = (id: string) => refs.campaigns.get(id) || `Chiến dịch mã ${shortId(id)}`;
  const warehouseName = (id: string) => refs.warehouses.get(id) || `Kho mã ${shortId(id)}`;

  const acceptSpec = (gap: SupplyGap): CommandSpec => {
    const draft = gap.draft || {};
    const draftItem = draft.items?.find((line) => line.item_id === gap.item_id) ?? draft.items?.[0];
    const unit = unitFor(gap);
    return {
      title: 'Tạo đợt quyên góp từ đề xuất',
      service: 'logistics',
      path: `/supply-gaps/${gap.id}/accept`,
      version: gap.version,
      warning: 'Xác nhận tạo đợt quyên góp ở trạng thái nháp từ đề xuất này? Đợt sẽ chưa mở cho người đóng góp cho đến khi được mở.',
      fields: [
        { name: 'title', label: 'Tên đợt quyên góp', required: true, maxLength: 200, initialValue: draft.title ?? '' },
        { name: 'description', label: 'Mô tả đợt quyên góp (nếu có)', type: 'textarea', initialValue: draft.description ?? '' },
        {
          name: 'target_quantity',
          label: `Số lượng mục tiêu${unit ? ` (${unit})` : ''}`,
          type: 'number',
          required: true,
          scaleFor: () => gap.scale,
          initialValue: draftItem?.target_quantity ?? '',
        },
        { name: 'opens_at', label: 'Thời điểm mở (nếu có)', type: 'datetime-local', initialValue: isoToLocalInput(draft.opens_at) },
        { name: 'closes_at', label: 'Thời điểm đóng (nếu có)', type: 'datetime-local', initialValue: isoToLocalInput(draft.closes_at) },
      ],
      build: (values) => {
        const opensAt = values.opens_at ? new Date(values.opens_at) : null;
        const closesAt = values.closes_at ? new Date(values.closes_at) : null;
        if (opensAt && closesAt && closesAt <= opensAt) throw new Error('Thời điểm đóng phải sau thời điểm mở.');
        return {
          overrides: {
            title: values.title,
            description: values.description?.trim() ? values.description : null,
            items: [{
              item_id: gap.item_id,
              target_quantity: values.target_quantity,
              ...(draftItem?.acceptance_note ? { acceptance_note: draftItem.acceptance_note } : {}),
            }],
            ...(opensAt ? { opens_at: opensAt.toISOString() } : {}),
            ...(closesAt ? { closes_at: closesAt.toISOString() } : {}),
          },
        };
      },
    };
  };

  const dismissSpec = (gap: SupplyGap): CommandSpec => ({
    title: 'Bỏ qua đề xuất',
    service: 'logistics',
    path: `/supply-gaps/${gap.id}/dismiss`,
    version: gap.version,
    warningFor: () => gap.severity === 'RED'
      ? 'Bỏ qua đề xuất thiếu hàng này? Đề xuất sẽ không hiện lại trong thời gian làm nguội, trừ khi tình trạng thiếu hàng nặng thêm.'
      : 'Bỏ qua cảnh báo sắp thiếu này? Cảnh báo chỉ hiện lại khi chuyển thành thiếu hàng.',
    fields: [
      { name: 'reason', label: 'Lý do bỏ qua', type: 'textarea', required: true, maxLength: 500 },
      { name: 'dismissed_days', label: 'Số ngày không hiện lại (1–90, mặc định 7)', type: 'number', integer: true, min: 1, max: 90, initialValue: '7' },
    ],
    build: (values) => ({
      reason: values.reason,
      ...(values.dismissed_days?.trim() ? { dismissed_days: Number(values.dismissed_days) } : {}),
    }),
  });

  const selectedRow = detail;
  const canAccept = Boolean(selectedRow && canManage && canAcceptSupplyGap(selectedRow));
  const canDismiss = Boolean(selectedRow && canManage && canDismissSupplyGap(selectedRow));
  const yellowOpen = Boolean(selectedRow && selectedRow.status === 'OPEN' && selectedRow.severity === 'YELLOW');

  return (
    <section className="card supply-inbox" aria-labelledby="supply-inbox-title">
      <div className="section-header list-action-header">
        <div>
          <span className="eyebrow">Đề xuất quyên góp</span>
          <h2 id="supply-inbox-title">Đề xuất bổ sung vật tư theo kho</h2>
        </div>
        <div className="list-header-actions">
          <button type="button" className="button secondary refresh-action" disabled={loading} onClick={() => { setCursor(''); setRevision((value) => value + 1); }}>Làm mới</button>
        </div>
      </div>
      <p className="muted">Hệ thống chỉ đề xuất. Chỉ quản lý vận hành mới tạo đợt quyên góp từ đề xuất thiếu hàng (mức đỏ).</p>
      <div className="filter">
        <label htmlFor="supply-status-filter">Trạng thái đề xuất</label>
        <Dropdown id="supply-status-filter" value={status} onChange={(event) => changeStatus(event.target.value)}>
          {supplyGapStatusOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Dropdown>
      </div>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {loading && <Skeleton rows={3} label="Đang tải đề xuất quyên góp…" />}
      {!loading && !error && !items.length && (
        <EmptyState title="Chưa có đề xuất nào" description={`Không có đề xuất ở trạng thái “${labelFor(supplyGapStatusLabels, status, 'đã chọn')}”.`} />
      )}
      {items.length > 0 && (
        <div className="operations-table-scroll" role="region" aria-label="Bảng đề xuất quyên góp" tabIndex={0}>
          <table className="operations-record-table">
            <thead>
              <tr>
                <th scope="col">Kho và vật phẩm</th>
                <th scope="col">Mức</th>
                <th scope="col">Nhu cầu</th>
                <th scope="col">Nguồn hàng</th>
                <th scope="col">Đã có đợt quyên góp</th>
                <th scope="col">Còn thiếu</th>
                <th scope="col">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {items.map((gap) => {
                const unit = unitFor(gap);
                return (
                  <tr key={gap.id}>
                    <th scope="row">
                      <button type="button" className="table-row-link" aria-haspopup="dialog" onClick={() => { setAction(null); setNotice(''); setSelectedId(gap.id); }}>
                        {gap.warehouse_name} · {gap.item_name}
                      </button>
                    </th>
                    <td><SeverityBadge severity={gap.severity} /></td>
                    <td>{quantityText(gap.demand, unit)}</td>
                    <td>{quantityText(gap.supply, unit)}</td>
                    <td>{quantityText(gap.pledged, unit)}</td>
                    <td><strong>{quantityText(gap.gap_qty, unit)}</strong></td>
                    <td>
                      <Badge tone={labelFor(supplyGapStatusTones, gap.status, 'neutral') as BadgeTone}>
                        {labelFor(supplyGapStatusLabels, gap.status, 'Chưa rõ trạng thái')}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ListNav page={pageIndex} hasNext={Boolean(next)} loading={loading} onPrev={prevPage} onNext={() => next && setCursor(next)} count={items.length} noun="đề xuất" />

      {selectedId && (
        <DetailSurface
          key={selectedId}
          modal
          open
          onClose={() => { setSelectedId(null); setAction(null); setNotice(''); }}
          label={detail ? `Chi tiết đề xuất ${detail.warehouse_name} ${detail.item_name}` : 'Chi tiết đề xuất quyên góp'}
          heading={detail ? `${detail.warehouse_name} · ${detail.item_name}` : 'Chi tiết đề xuất'}
          className="campaign-management-dialog supply-detail-dialog"
        >
          {detailError && <p className="notice error" role="alert">{detailError}</p>}
          {!detail && !detailError && <p role="status">Đang tải chi tiết…</p>}
          {detail && (
            <SupplyGapDetail
              gap={detail}
              unit={unitFor(detail)}
              campaignName={campaignName}
              warehouseName={warehouseName}
              backupStock={backupStock}
              canAccept={canAccept}
              canDismiss={canDismiss}
              yellowOpen={yellowOpen}
              canManage={canManage}
              action={action}
              onAction={setAction}
              acceptSpec={acceptSpec(detail)}
              dismissSpec={dismissSpec(detail)}
              onAccepted={(result) => {
                const driveId = (result as SupplyGap | undefined)?.drive_id;
                reloadAfterChange(driveId ? `Đã tạo đợt quyên góp nháp (mã ${shortId(driveId)}). Đề xuất đã được chuyển sang trạng thái đã tạo đợt quyên góp.` : 'Đã tạo đợt quyên góp nháp.');
              }}
              onDismissed={() => reloadAfterChange('Đã bỏ qua đề xuất. Đề xuất sẽ không hiện lại trong thời gian làm nguội.')}
              onStale={() => reloadAfterChange('Đề xuất đã thay đổi hoặc không còn mở. Dữ liệu đã được tải lại; hãy kiểm tra trạng thái mới trước khi thao tác tiếp.')}
            />
          )}
        </DetailSurface>
      )}
    </section>
  );
}

function SupplyGapDetail({
  gap, unit, campaignName, warehouseName, backupStock, canAccept, canDismiss, yellowOpen, canManage, action, onAction,
  acceptSpec, dismissSpec, onAccepted, onDismissed, onStale,
}: {
  gap: SupplyGap;
  unit: string;
  campaignName: (id: string) => string;
  warehouseName: (id: string) => string;
  backupStock: Map<string, string>;
  canAccept: boolean;
  canDismiss: boolean;
  yellowOpen: boolean;
  canManage: boolean;
  action: 'accept' | 'dismiss' | null;
  onAction: (value: 'accept' | 'dismiss' | null) => void;
  acceptSpec: CommandSpec;
  dismissSpec: CommandSpec;
  onAccepted: (result?: unknown) => void;
  onDismissed: (result?: unknown) => void;
  onStale: () => void;
}) {
  const draft = gap.draft || {};
  const draftItem = draft.items?.find((line) => line.item_id === gap.item_id) ?? draft.items?.[0];
  return (
    <div className="supply-detail">
      <div className="supply-action-row" aria-label="Trạng thái đề xuất">
        <SeverityBadge severity={gap.severity} />
        <Badge tone={labelFor(supplyGapStatusTones, gap.status, 'neutral') as BadgeTone}>
          {labelFor(supplyGapStatusLabels, gap.status, 'Chưa rõ trạng thái')}
        </Badge>
      </div>
      <p>{labelFor(severityDescriptions, gap.severity, '')}</p>

      {gap.reasons.length > 0 && (
        <section aria-label="Lý giải đề xuất">
          <h3>Lý giải</h3>
          <ul>{gap.reasons.map((reason) => <li key={reason.code}>{reason.message}</li>)}</ul>
        </section>
      )}

      <dl className="supply-facts">
        <div><dt>Nhu cầu đang chờ</dt><dd>{quantityText(gap.demand, unit)}</dd></div>
        <div><dt>Nguồn hàng khả dụng</dt><dd>{quantityText(gap.supply, unit)}</dd></div>
        <div><dt>Đã có đợt quyên góp</dt><dd>{quantityText(gap.pledged, unit)}</dd></div>
        <div><dt>Còn thiếu</dt><dd>{quantityText(gap.gap_qty, unit)}</dd></div>
        <div><dt>Nhu cầu ước tính (chưa tính vào thiếu hàng)</dt><dd>{quantityText(gap.forecast_demand, unit)}</dd></div>
        <div><dt>Cập nhật lúc</dt><dd>{gap.computed_at ? timeLabel(gap.computed_at) : 'Chưa rõ'}</dd></div>
      </dl>

      <section aria-label="Chiến dịch liên quan">
        <h3>Chiến dịch dùng kho này</h3>
        {gap.campaign_ids.length
          ? <ul>{gap.campaign_ids.map((id) => <li key={id}>{campaignName(id)}</li>)}</ul>
          : <p className="muted">Không có chiến dịch nào đang dùng kho này cho vật phẩm này.</p>}
      </section>

      <section aria-label="Kho dự phòng">
        <h3>Kho dự phòng có tồn kho</h3>
        {gap.backup_warehouse_ids.length
          ? <ul>{gap.backup_warehouse_ids.map((id) => (
            <li key={id}>{warehouseName(id)}: tồn khả dụng {quantityText(backupStock.get(id) ?? '0', unit)}</li>
          ))}</ul>
          : <p className="muted">Chưa có kho dự phòng nào. Hệ thống không tự chuyển hàng giữa các kho.</p>}
      </section>

      <section aria-label="Bản nháp đợt quyên góp">
        <h3>Bản nháp đợt quyên góp</h3>
        {gap.status === 'ACCEPTED' && gap.drive_id && <p>Đã tạo đợt quyên góp (mã {shortId(gap.drive_id)}). Đợt này ở trạng thái nháp cho đến khi được mở.</p>}
        {gap.status === 'DISMISSED' && (
          <p>Đã bỏ qua{gap.dismissed_reason ? `: ${gap.dismissed_reason}` : '.'}{gap.dismissed_until ? ` Không hiện lại đến ${dateLabel(gap.dismissed_until.slice(0, 10))}.` : ''}</p>
        )}
        {draft.title && (
          <dl className="fact-list">
            <div><dt>Tên đề xuất</dt><dd>{draft.title}</dd></div>
            <div><dt>Kho tiếp nhận</dt><dd>{draft.intake_warehouse_id ? warehouseName(draft.intake_warehouse_id) : 'Chưa rõ'}</dd></div>
            <div><dt>Chiến dịch đích</dt><dd>{draft.campaign_id ? campaignName(draft.campaign_id) : 'Không gắn chiến dịch'}</dd></div>
            <div><dt>Số lượng mục tiêu</dt><dd>{draftItem ? quantityText(draftItem.target_quantity, unit) : 'Chưa có'}</dd></div>
            <div><dt>Thời gian dự kiến</dt><dd>Mở: {draft.opens_at ? timeLabel(draft.opens_at) : 'Chưa đặt'} · Đóng: {draft.closes_at ? timeLabel(draft.closes_at) : 'Chưa đặt'}</dd></div>
          </dl>
        )}
      </section>

      {yellowOpen && (
        <p className="notice warning supply-yellow-note" role="note">
          Mức vàng chỉ là cảnh báo. Hệ thống không tạo đợt quyên góp từ mức này. Hãy theo dõi kho, hoặc bỏ qua cảnh báo nếu không cần xử lý.
        </p>
      )}

      {!canManage && <p className="muted">Chỉ quản lý vận hành mới được tạo đợt quyên góp hoặc bỏ qua đề xuất.</p>}

      {canManage && (canAccept || canDismiss) && (
        <div className="supply-action-row">
          {canAccept && <button type="button" className="button primary" aria-expanded={action === 'accept'} onClick={() => onAction(action === 'accept' ? null : 'accept')}>Tạo đợt quyên góp</button>}
          {canDismiss && <button type="button" className="button secondary" aria-expanded={action === 'dismiss'} onClick={() => onAction(action === 'dismiss' ? null : 'dismiss')}>Bỏ qua</button>}
        </div>
      )}
      {canManage && action === 'accept' && canAccept && (
        <CommandForm key={`accept-${gap.id}-${gap.version}`} spec={acceptSpec} onSuccess={onAccepted} onStale={onStale} />
      )}
      {canManage && action === 'dismiss' && canDismiss && (
        <CommandForm key={`dismiss-${gap.id}-${gap.version}`} spec={dismissSpec} onSuccess={onDismissed} onStale={onStale} />
      )}
    </div>
  );
}
