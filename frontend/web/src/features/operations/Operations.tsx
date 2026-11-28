import { ReconciliationTable, reconciliationMetrics, reconciliationResult } from './ReconciliationTable';
import { Dropdown } from '../../components/ui/Dropdown';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';
import { useCursorNav, LIST_PAGE_SIZE } from '../../api/useCursorNav';
import { ListNav } from '../../components/ui/Pager';
import { WarehouseMapManager } from './WarehouseMapManager';
import { roles, type Me } from '../../auth/session';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { dateLabel, label, timeLabel } from '../../i18n/labels';
import { formatQuantity } from '../../i18n/quantity';
import { itemUnitName } from '../../i18n/units';
import { ReceiptCountForm } from './ReceiptCountForm';
import { operationRecordKey } from './recordKey';
import { RecoveryIssue } from '../../components/RecoveryIssue';
import { DetailSurface } from '../../components/DetailSurface';
import { Tabs } from '../../components/ui/Tabs';
import { StatusBadge } from '../../components/StatusBadge';
import { useUrlView } from '../../app/useUrlView';
import { useUrlRecord } from '../../app/useUrlRecord';
import { canNavigateAway } from '../../app/navigationGuard';
import { assetViews, reportViews, reviewViews } from '../../app/routeViews';

type Row = Record<string, unknown> & {
  id?: string;
  status?: string;
  version?: number;
  title?: string;
  name?: string;
  public_code?: string;
  receipt_id?: string | null;
};

type List = {
  items?: Row[];
  cursor?: string | null;
  next_cursor?: string | null;
  more?: boolean;
  generated_at?: string;
};
type ReferenceOptions = Record<string, { value: string; label: string }[]>;
const referenceCache = new Map<string, { expiresAt: number; options: ReferenceOptions }>();
const receiptStatuses = ['', 'DECLARED', 'COUNTING', 'PENDING_REVIEW', 'APPROVED', 'POSTED', 'REJECTED'] as const;
const reviewQueueStatuses = ['', 'DECLARED', 'COUNTING', 'PENDING_REVIEW'] as const;
const reviewWorkOptions = [
  { value: 'DECLARED', label: 'Cần đếm', hint: 'Phiếu đã khai báo, chưa gửi kết quả kiểm đếm.' },
  { value: 'COUNTING', label: 'Cần đếm lại', hint: 'Phiếu đang kiểm đếm hoặc đã được yêu cầu đếm lại.' },
  { value: 'PENDING_REVIEW', label: 'Cần xác nhận', hint: 'Đã có kết quả đếm, cần người khác xác nhận độc lập.' },
  { value: '', label: 'Tất cả', hint: 'Tất cả trạng thái trong phạm vi bạn được phép xem.' },
] as const;
const routes: Record<string, string> = {
  overview: '/reports/stock-summary',
  drives: '/donation-drives',
  intake: '/donation-deliveries',
  review: '/donation-deliveries',
  stock: '/stock',
  assets: '/warehouses',
  reports: '/reports/stock-summary',
};
const headings: Record<string, string> = {
  overview: 'Tình hình vật tư',
  drives: 'Danh sách đợt quyên góp',
  intake: 'Tiếp nhận đóng góp',
  review: 'Duyệt biên nhận',
  stock: 'Tồn kho theo kho',
  assets: 'Kho',
  reports: 'Báo cáo vận hành',
};
const string = (value: unknown) => (typeof value === 'string' ? value : '');
const number = (value: unknown) => (typeof value === 'number' ? value : undefined);
const quantity = formatQuantity;
function quantityWithUnit(item: Row, value: unknown, fallbackUnit = ''): string {
  const unit = itemUnitName(item.item_id || (item.item as Row | undefined)?.id, string((item.unit as Row | undefined)?.display_name) || string(item.unit_name) || fallbackUnit || string(item.unit_code));
  return `${quantity(value)}\u00a0${unit || '(chưa rõ đơn vị)'}`;
}
function recordTitle(page: string, item: Row): string {
  if (page === 'intake')
    return string(item.donor_name) ? `Đóng góp của ${item.donor_name}` : 'Đóng góp chờ tiếp nhận';
  return (
    item.title ||
    item.name ||
    item.public_code ||
    string(item.identifier) ||
    string(item.item_name) ||
    string((item.item as Row | undefined)?.name) ||
    item.id ||
    'Bản ghi'
  );
}
/** Compact target-versus-received view of a drive's item list: the three least-covered items plus an overall bar. */
function DriveNeedProgress({ items }: { items: Row[] }) {
  if (!items.length) return <span className="muted">Chưa khai báo vật phẩm</span>;
  const rows = items.map((item) => {
    const target = Number(item.target_quantity ?? 0);
    const received = Number(item.accepted_total ?? 0);
    return { item, target, received, ratio: target > 0 ? Math.min(1, received / target) : 0 };
  }).sort((a, b) => a.ratio - b.ratio);
  const overall = rows.reduce((total, row) => total + row.ratio, 0) / rows.length;
  return <div className="drive-need">
    <div className="drive-need__overall" title={`Đạt trung bình ${Math.round(overall * 100)}% mục tiêu`}>
      <span className="drive-need__track"><span className="drive-need__fill" style={{ width: `${Math.round(overall * 100)}%` }} /></span>
      <strong>{Math.round(overall * 100)}%</strong>
    </div>
    <ul className="drive-need__items">
      {rows.slice(0, 3).map(({ item, target, received }) => <li key={string(item.item_id)}>
        <span>{string(item.item_name) || 'Vật phẩm'}</span>
        <span className="muted">{quantity(received)}/{quantityWithUnit(item, target)}</span>
      </li>)}
      {rows.length > 3 && <li className="muted">+{rows.length - 3} vật phẩm khác</li>}
    </ul>
  </div>;
}
const fields = (entries: [string, string, boolean?][]) =>
  entries.map(([name, title, required]) => ({ name, label: title, required }));

function readReportFilters(userId: string): { warehouse?: string } {
  try {
    const saved = JSON.parse(sessionStorage.getItem(`operations-filters:${userId}`) || '{}');
    return {
      warehouse: typeof saved?.warehouse === 'string' ? saved.warehouse : '',
    };
  } catch { return {}; }
}

export function Operations({ page, user }: { page: string; user: Me }) {
  const rights = roles(user);
  const [asset] = useUrlView('view', assetViews, 'warehouses');
  const [reviewTab, setReviewTab] = useUrlView('view', reviewViews, 'receipts');
  const [report, setReport] = useUrlView('view', reportViews, 'stock-summary');
  const [warehouse, setWarehouse] = useState(() => readReportFilters(user.id).warehouse || '');
  const [receiptCampaign, setReceiptCampaign] = useUrlRecord('receipt_campaign');
  const [receiptWarehouse, setReceiptWarehouse] = useUrlRecord('receipt_warehouse');
  const [receiptStatus, setReceiptStatus] = useUrlView<string>('receipt_status', page === 'review' ? reviewQueueStatuses : receiptStatuses, page === 'review' ? 'PENDING_REVIEW' : '');
  const [seenFilters, setSeenFilters] = useState<{ campaigns: Record<string, string>; warehouses: Record<string, string> }>({ campaigns: {}, warehouses: {} });
  const initialReportFilters = useRef({ warehouse: false });
  const [items, setItems] = useState<Row[]>([]);
  const [cursor, setCursor, prevPage, pageIndex] = useCursorNav<string>('');
  useEffect(() => {
    try { sessionStorage.setItem(`operations-filters:${user.id}`, JSON.stringify({ warehouse })); }
    catch { /* Filtering remains available when browser storage is disabled. */ }
  }, [user.id, warehouse]);
  const [next, setNext] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);
  const [driveItemPage, setDriveItemPage] = useState(0);
  const [detailTab, setDetailTab] = useState('overview');
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState<Row | null>(null);
  const driveItems = Array.isArray(detail?.items) ? detail.items as Row[] : [];
  const driveItemPageSize = 5;
  const driveItemPageCount = Math.max(1, Math.ceil(driveItems.length / driveItemPageSize));
  const visibleDriveItemPage = Math.min(driveItemPage, driveItemPageCount - 1);
  useEffect(() => setDriveItemPage(0), [selected?.id]);
  const [error, setError] = useState('');
  const [workflowNotice, setWorkflowNotice] = useState('');
  const [workflowNextQueue, setWorkflowNextQueue] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [references, setReferences] = useState<ReferenceOptions>({});
  useEffect(() => { setCursor(''); setSelected(null); setDetail(null); }, [receiptStatus, receiptCampaign, receiptWarehouse]);
  useEffect(() => {
    if (page !== 'intake' && page !== 'review') return;
    setSeenFilters((current) => {
      const next = { campaigns: { ...current.campaigns }, warehouses: { ...current.warehouses } };
      for (const item of items) {
        const campaignId = string(item.campaign_id);
        if (campaignId) next.campaigns[campaignId] = (references.campaignNames || []).find((option) => option.value === campaignId)?.label || `Chiến dịch …${campaignId.slice(-6)}`;
        const warehouseId = string(item.intake_warehouse_id);
        if (warehouseId) next.warehouses[warehouseId] = string(item.warehouse_name) || `Kho …${warehouseId.slice(-6)}`;
      }
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [items, page, references.campaignNames]);
  useEffect(() => {
    const cached = referenceCache.get(user.id);
    if (revision === 0 && cached && cached.expiresAt > Date.now()) {
      setReferences(cached.options);
      return;
    }
    let live = true;
    const sources = [
      ['warehouses', 'logistics', '/warehouses'],
      ['drives', 'logistics', '/donation-drives'],
      ['items', 'logistics', '/items'],
      ['campaigns', 'response', '/campaigns'],
    ] as const;
    void Promise.allSettled(sources.map(([, service, path]) => fetchAll<Row>(service, path))).then((results) => {
      if (!live) return;
      const options: Record<string, { value: string; label: string }[]> = {};
      results.forEach((result, index) => {
        if (result.status !== 'fulfilled') return;
        const key = sources[index][0];
        if (key === 'campaigns') options.campaignNames = result.value.filter(item => item.id)
          .map(item => ({ value: item.id!, label: string(item.name) || string(item.title) || `Chiến dịch mã …${item.id!.slice(-8)}` }));
        if (key === 'campaigns') options.campaignStatuses = result.value.filter(item => item.id && item.status)
          .map(item => ({ value: item.id!, label: string(item.status) }));
        if (key === 'items') options.itemScales = result.value.filter(item => item.id && Number.isInteger(Number((item.unit as Row | undefined)?.scale)))
          .map(item => ({ value: item.id!, label: String((item.unit as Row).scale) }));
        if (key === 'items') options.itemUnits = result.value.filter(item => item.id && string((item.unit as Row | undefined)?.display_name))
          .map(item => ({ value: item.id!, label: string((item.unit as Row).display_name) }));
        options[key] = result.value
          .filter((item) => (item.id || item.code) && (!['campaigns', 'warehouses', 'items'].includes(key) || item.status === 'ACTIVE'))
          .map((item) => ({
            value: item.id!,
            label: string(item.name) || string(item.title) || string(item.identifier) ||
                string(item.item_name) || `Mã …${item.id!.slice(-8)}`,
          }));
      });
      if (!options.warehouses?.length) {
        const driveResult = results[1];
        if (driveResult.status === 'fulfilled') {
          options.driveWarehouses = driveResult.value
            .filter((drive) => drive.id && string(drive.intake_warehouse_id))
            .map((drive) => ({ value: drive.id!, label: string(drive.intake_warehouse_id) }));
          const byWarehouse = new Map<string, string>();
          for (const drive of driveResult.value) {
            const warehouseId = string(drive.intake_warehouse_id);
            if (warehouseId && !byWarehouse.has(warehouseId)) {
              byWarehouse.set(warehouseId, string(drive.warehouse_name) || `Kho tiếp nhận · …${warehouseId.slice(-8)}`);
            }
          }
          options.warehouses = [...byWarehouse].map(([value, label]) => ({ value, label }));
        }
      }
      setReferences(options);
      referenceCache.set(user.id, { expiresAt: Date.now() + 30_000, options });
    });
    return () => { live = false; };
  }, [revision, user.id]);
  const warehouseOptions = [...(references.warehouses || [])];
  useEffect(() => {
    if (!initialReportFilters.current.warehouse && warehouseOptions.length) {
      initialReportFilters.current.warehouse = true;
      if (!warehouseOptions.some(option => option.value === warehouse)) setWarehouse(warehouseOptions[0].value);
    }
  }, [references]);
  for (const item of items) {
    const id = string(item.warehouse_id);
    if (id && !warehouseOptions.some((option) => option.value === id))
      warehouseOptions.push({ value: id, label: `Kho đang sử dụng · …${id.slice(-8)}` });
  }
  const warehouseName = (id: unknown) =>
    warehouseOptions.find((warehouse) => warehouse.value === id)?.label ||
    (typeof id === 'string' ? `Kho mã …${id.slice(-8)}` : 'Chưa rõ kho');
  const lineQuantity = (item: Row, value: unknown) => quantityWithUnit(item, value, references.itemUnits?.find(unit => unit.value === item.item_id)?.label);
  const route =
    page === 'assets'
      ? `/${asset}`
      : page === 'reports'
        ? report === 'reconciliation'
          ? '/reconciliation'
          : `/reports/${report}`
        : page === 'review' && reviewTab === 'disputes'
          ? '/donation-disputes'
          : routes[page];
  const params = new URLSearchParams();
  params.set('limit', String(LIST_PAGE_SIZE));
  if ((page === 'stock' || (page === 'reports' && report === 'stock-summary')) && warehouse)
    params.set('warehouse_id', warehouse);
  if (cursor) params.set('cursor', cursor);
  if (page === 'intake' || (page === 'review' && reviewTab === 'receipts')) {
    if (receiptCampaign) params.set('campaign_id', receiptCampaign);
    if (receiptWarehouse) params.set('warehouse_id', receiptWarehouse);
    if (receiptStatus) params.set('status', receiptStatus);
  }
  if (page === 'reports' && report === 'reconciliation' && warehouse)
    params.set('warehouse_id', warehouse);
  const path = route + (params.size ? `?${params}` : '');
  const ready = !(page === 'reports' && report === 'reconciliation' && !warehouse);
  useEffect(() => {
    if (!route || !ready) {
      setItems([]);
      setNext(null);
      setGeneratedAt('');
      setSelected(null);
      setError('');
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setError('');
    if (!cursor) setItems([]);
    api<List>('logistics', path)
      .then((value) => {
        if (live) {
          setItems(value.items || []);
          setSelected(current => current
            ? value.items?.find(item => operationRecordKey(item) === operationRecordKey(current)) || (cursor ? current : null)
            : null);
          setNext(value.next_cursor || (value.more ? value.cursor || null : null));
          setGeneratedAt(value.generated_at || '');
        }
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [path, ready, revision]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let live = true;
    setDetail(null);
    const detailPath =
      page === 'intake' || (page === 'review' && reviewTab === 'receipts')
        ? selected.receipt_id
          ? `/donation-receipts/${selected.receipt_id}`
          : ''
        : '';
    if (!detailPath) {
      setDetail(selected);
      return;
    }
    api<Row>('logistics', detailPath)
      .then((value) => {
        if (live) setDetail(value);
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải chi tiết.');
      });
    return () => {
      live = false;
    };
  }, [selected, revision, page, reviewTab, asset]);
  function done() {
    // Keep workflow records open so staff can follow the next processing step.
    const keepDetail = ((page === 'intake' || page === 'review') && selected?.receipt_id)
      || ((page === 'assets' || page === 'drives' || (page === 'review' && reviewTab === 'disputes')) && selected?.id);
    if (!keepDetail) setSelected(null);
    setDetail(null);
    setDetailTab('overview');
    setShowCreate(false);
    setRevision((value) => value + 1);
  }
  function command(spec: CommandSpec) {
    return (
      <CommandForm key={spec.path + String(spec.version ?? '')} spec={spec} onSuccess={() => done()} onStale={() => setRevision((value) => value + 1)} />
    );
  }
  function counted(result?: { confirmation?: { matched: boolean; posted?: boolean } }) {
    const confirmation = result?.confirmation;
    setWorkflowNextQueue(confirmation ? confirmation.matched ? null : 'COUNTING' : 'PENDING_REVIEW');
    setWorkflowNotice(confirmation
      ? confirmation.matched ? confirmation.posted ? 'Hai lượt kiểm đếm khớp nhau. Biên nhận đã ghi sổ kho.' : 'Hai lượt kiểm đếm khớp nhau. Kiểm tra trạng thái biên nhận để theo dõi ghi sổ.'
        : 'Hai lượt kiểm đếm chưa khớp. Hàng chưa được ghi sổ; mở mục “Cần đếm lại” để xử lý.'
      : 'Đã gửi kết quả kiểm đếm. Cần người thứ hai kiểm đếm độc lập trước khi ghi sổ.');
    done();
  }
  const id = detail?.id;
  const version = number(detail?.version);
  const status = string(detail?.delivery_status || detail?.status);
  const showActionsTab = page === 'drives'
    ? ['DRAFT', 'OPEN', 'PAUSED'].includes(status) && (rights.has('COORDINATOR') || rights.has('OPERATIONS_MANAGER'))
    : page === 'intake' ? rights.has('OPERATIONS_MANAGER')
      : page === 'review' ? rights.has('REVIEWER') : false;
  const inlineActions = page === 'intake' || page === 'review';
  const stockDetail = page === 'stock' || (page === 'reports' && report === 'stock-summary');
  const receiptId =
    page === 'intake' || (page === 'review' && reviewTab === 'receipts')
      ? string(selected?.receipt_id)
      : '';
  const count = detail?.count as Row | null | undefined;
  const ownPendingCount = count?.is_own_count === true;
  const countedBefore = count?.is_count_author === true;
  const canCount = (page === 'intake' && rights.has('OPERATIONS_MANAGER')) ||
    (page === 'review' && reviewTab === 'receipts' && rights.has('REVIEWER'));
  const canCreatePage = page === 'drives' && (rights.has('COORDINATOR') || rights.has('OPERATIONS_MANAGER'));
  function clearReceiptFilters() {
    const url = new URL(window.location.href);
    url.searchParams.delete('receipt_campaign');
    url.searchParams.delete('receipt_warehouse');
    url.searchParams.set('receipt_status', '');
    window.history.pushState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
  const createTitle = page === 'drives' ? 'Tạo đợt quyên góp' : 'Thêm kho';
  useEffect(() => { setShowCreate(false); }, [page, asset]);
  return (
    <div className={`operations-workspace${page === 'assets' && asset === 'warehouses' ? ' operations-workspace--warehouse-map' : ''}`}>
      <section className="card">
        {!(page === 'assets' && asset === 'warehouses') && <div className="section-header list-action-header">
          <h2>{page === 'review' && reviewTab === 'disputes' ? 'Xử lý khiếu nại' : headings[page]}</h2>
          <div className="list-header-actions">
            <button type="button" className="button secondary refresh-action" disabled={loading} onClick={() => { setCursor(''); setRevision((value) => value + 1); }}>Làm mới</button>
            {canCreatePage && <button type="button" className="button primary list-create-button" onClick={() => {
              if (page === 'drives') {
                const url = new URL(window.location.href);
                url.search = new URLSearchParams({ workspace: 'operations', page: 'assets', view: 'warehouses', create: 'drive' }).toString();
                window.history.pushState(null, '', url);
                window.dispatchEvent(new PopStateEvent('popstate'));
                return;
              }
              setSelected(null); setDetail(null); setShowCreate(true);
            }}>{createTitle}</button>}
          </div>
        </div>}
        {page === 'assets' && asset === 'warehouses' && <WarehouseMapManager
          canManage={rights.has('OPERATIONS_MANAGER')} canManageDrives={rights.has('OPERATIONS_MANAGER') || rights.has('COORDINATOR')}
          warehouseOptions={warehouseOptions} campaigns={references.campaigns || []} items={references.items || []} itemScales={references.itemScales || []} itemUnits={references.itemUnits || []}
          refreshKey={revision} onChanged={() => setRevision((value) => value + 1)} onRefresh={() => { setCursor(''); setRevision(value => value + 1); }} />}
        {page === 'review' && (
          <div className="receipt-status-filters" role="group" aria-label="Loại hồ sơ cần duyệt">
            <button
              aria-pressed={reviewTab === 'receipts'} className={reviewTab === 'receipts' ? 'active' : ''}
              onClick={() => {
                setReviewTab('receipts');
                setCursor('');
                setSelected(null);
              }}
            >
              Biên nhận
            </button>
            <button
              aria-pressed={reviewTab === 'disputes'} className={reviewTab === 'disputes' ? 'active' : ''}
              onClick={() => {
                setReviewTab('disputes');
                setCursor('');
                setSelected(null);
              }}
            >
              Khiếu nại
            </button>
          </div>
        )}
        {(page === 'intake' || (page === 'review' && reviewTab === 'receipts')) && (
          <div className="receipt-filter-row">
            {page === 'review' && (
              <label className="filter">Việc cần làm
                <Dropdown aria-label="Việc cần làm" value={receiptStatus} onChange={event => { setReceiptStatus(event.target.value); setCursor(''); setSelected(null); setDetail(null); }}>
                  {reviewWorkOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Dropdown>
              </label>
            )}
            {([
              ['Chiến dịch', receiptCampaign, setReceiptCampaign, 'Tất cả chiến dịch',
                Object.entries(seenFilters.campaigns).map(([value, label]) => ({ value, label }))],
              ['Kho', receiptWarehouse, setReceiptWarehouse, 'Tất cả kho',
                Object.entries(seenFilters.warehouses).map(([value, label]) => ({ value, label }))],
              ...(page === 'review' ? [] : [['Trạng thái', receiptStatus, setReceiptStatus, 'Tất cả trạng thái', ([
                ['DECLARED', 'Đã khai báo'], ['COUNTING', 'Đang kiểm đếm'], ['PENDING_REVIEW', 'Chờ duyệt kiểm đếm'],
                ['APPROVED', 'Đã duyệt'], ['POSTED', 'Đã ghi sổ'], ['REJECTED', 'Bị từ chối'],
              ]).map(([value, title]) => ({ value, label: title }))] as const]),
            ] as const).map(([title, value, setValue, placeholder, options]) => (
              <label className="filter" key={title}>
                {title}
                <Dropdown value={value} onChange={(event) => { setValue(event.target.value); setCursor(''); setSelected(null); setDetail(null); }}>
                  <option value="">{placeholder}</option>
                  {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Dropdown>
              </label>
            ))}
            {(receiptCampaign || receiptWarehouse || receiptStatus) && (
              <div className="receipt-filter-actions"><button type="button" className="button secondary clear-receipt-filters" onClick={clearReceiptFilters}>Xóa bộ lọc</button></div>
            )}
            {page === 'review' && <p className="receipt-filter-hint" role="status">{reviewWorkOptions.find(option => option.value === receiptStatus)?.hint || 'Lọc theo trạng thái phiếu trong phạm vi bạn được phép xem.'}</p>}
          </div>
        )}
        {page === 'reports' && (
          <>
            <div className="tabs">
              {(
                [
                  ['stock-summary', 'Tồn kho'],
                  ['reconciliation', 'Kiểm tra số liệu'],
                ] as const
              ).map(([value, title]) => (
                <button
                  key={value}
                  className={report === value ? 'active' : ''}
                  onClick={() => {
                    setReport(value);
                    setCursor('');
                    setSelected(null);
                  }}
                >
                  {title}
                </button>
              ))}
            </div>
            {report === 'reconciliation' && (
              <label className="filter">
                Kho cần đối soát
                <Dropdown
                  value={warehouse}
                  onChange={(event) => {
                    setWarehouse(event.target.value);
                    setCursor('');
                    setSelected(null);
                    setDetail(null);
                  }}
                >
                  <option value="">Chọn kho</option>
                  {warehouseOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Dropdown>
              </label>
            )}
          </>
        )}
        {(page === 'stock' || (page === 'reports' && report === 'stock-summary')) && <label className="filter">
          Kho cần xem tồn
          <Dropdown value={warehouse} onChange={(event) => {
            setWarehouse(event.target.value);
            setCursor(''); setSelected(null); setDetail(null);
          }}>
            <option value="">Tất cả kho được cấp quyền</option>
            {warehouseOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Dropdown>
        </label>}
        {!ready && <p>Chọn kho hoặc chiến dịch để tải báo cáo theo phạm vi được cấp quyền.</p>}
        {workflowNotice && <p className="notice" role="status">{workflowNotice}</p>}
        {page === 'review' && workflowNextQueue && receiptStatus !== workflowNextQueue && <button type="button" className="button secondary" onClick={() => { setReceiptStatus(workflowNextQueue); setCursor(''); setSelected(null); setDetail(null); }}>{workflowNextQueue === 'COUNTING' ? 'Xem phiếu cần đếm lại' : 'Xem phiếu cần xác nhận'}</button>}
        {loading && <p role="status">Đang tải dữ liệu…</p>}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {generatedAt && <p className="muted">Dữ liệu tạo lúc {timeLabel(generatedAt)}</p>}
        {!loading && ready && !error && !items.length && (
          <div className="empty">Chưa có bản ghi trong phạm vi được cấp quyền.</div>
        )}
        {page === 'stock' || (page === 'reports' && report === 'stock-summary') ? (
          <>
            <p className="table-swipe-hint">Vuốt ngang bảng để xem các cột số lượng.</p>
            <div className="stock-table-scroll" role="region" aria-label="Tồn kho và lượng hàng có thể giao" tabIndex={0}>
              <table className="stock-table stock-table--summary">
                <thead>
                  <tr>
                    <th>Vật phẩm</th>
                    {!warehouse && <th>Kho</th>}
                    <th className="numeric">Khả dụng</th>
                    <th className="numeric">Đã giữ</th>
                    <th className="numeric">Tồn thực tế</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={operationRecordKey(item)}
                      className={selected && operationRecordKey(selected) === operationRecordKey(item) ? 'selected' : ''}
                    >
                      <th scope="row">
                        <button
                          type="button"
                          className="table-row-link"
                          onClick={() => setSelected(item)}
                        >
                          {string((item.item as Row | undefined)?.name) ||
                            string(item.item_name) ||
                            item.name ||
                            'Vật phẩm'}
                        </button>
                        <small className="stock-unit">{itemUnitName(item.item_id || (item.item as Row | undefined)?.id, string((item.unit as Row | undefined)?.display_name) || string(item.unit) || string(item.unit_name)) || 'Chưa rõ đơn vị'}</small>
                      </th>
                      {!warehouse && <td>
                        {string(item.warehouse_name) ||
                          (item.warehouse_id ? warehouseName(item.warehouse_id) : '—')}
                      </td>}
                      <td className="numeric">
                        <strong className={`available-value${Number(item.available) === 0 ? ' available-value--empty' : ''}`}>{quantity(item.available)}</strong>
                      </td>
                      <td className="numeric">{quantity(item.reserved)}</td>
                      <td className="numeric">{quantity(item.on_hand)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : page === 'reports' && report === 'reconciliation' ? (
          <ReconciliationTable rows={items} />
        ) : page === 'assets' ? null : (
          <div className="operations-table-scroll" role="region" aria-label={`Bảng ${headings[page] || 'bản ghi'}`} tabIndex={0}>
            <table className={`operations-record-table${page === 'drives' ? ' operations-record-table--drives' : ''}`}>
              <thead><tr><th scope="col">{page === 'assets' ? 'Kho' : page === 'intake' ? 'Người đóng góp' : page === 'review' ? 'Mã phiếu' : page === 'drives' ? 'Đợt quyên góp' : 'Vật phẩm'}</th>{page !== 'assets' && page !== 'drives' && <th scope="col">{page === 'intake' || page === 'review' ? 'Đợt quyên góp' : 'Nhu cầu và kết quả'}</th>}
                {page === 'drives' && <><th scope="col">Nhu cầu và tiến độ</th><th scope="col">Lượt đóng góp</th></>}
                <th scope="col">{page === 'drives' ? 'Thời gian mở' : 'Tiếp nhận lúc'}</th><th scope="col">Trạng thái</th></tr></thead>
              <tbody>{items.map((item) => <tr key={operationRecordKey(item)}>
                <th scope="row">{page === 'assets' && asset === 'warehouses' && item.id
                  ? <a className="table-row-link" href={`?workspace=operations&page=assets&view=warehouses&warehouse_id=${encodeURIComponent(item.id)}&warehouse_name=${encodeURIComponent(recordTitle(page, item))}`} aria-label={`Xem tồn kho ${recordTitle(page, item)}`}>{recordTitle(page, item)}</a>
                  : <button type="button" className="table-row-link" onClick={() => { setDetailTab('overview'); setSelected(item); }}>{recordTitle(page, item)}</button>}
                  {page === 'drives' && <small className="drive-row__meta">
                    {string(item.warehouse_name) || 'Kho tiếp nhận chưa rõ'}
                    {' · '}{item.campaign_id ? references.campaignNames?.find((option) => option.value === item.campaign_id)?.label || 'Có chiến dịch liên kết' : 'Không liên kết chiến dịch'}
                  </small>}</th>
                {page === 'drives' && <td><DriveNeedProgress items={Array.isArray(item.items) ? item.items as Row[] : []} /></td>}
                {page === 'drives' && <td className="drive-row__donations">
                  <strong>{Number(item.delivery_count ?? 0)}</strong> lượt
                  <small>{Number(item.posted_delivery_count ?? 0)} đã nhập kho</small>
                </td>}
                {page !== 'assets' && page !== 'drives' && <td>{item.requested != null ? `Cần ${quantityWithUnit(item, item.requested)} · Đã giao ${quantityWithUnit(item, item.delivered)}`
                  : item.active_requested != null ? `Cần ${quantityWithUnit(item, item.active_requested)} · Đã giao ${quantityWithUnit(item, item.delivered)}`
                  : item.drive_title ? string(item.drive_title)
                  : item.warehouse_name ? string(item.warehouse_name)
                  : item.donor_name ? `Người đóng góp: ${string(item.donor_name)}`
                  : item.receipt_id ? 'Đã lập biên nhận' : '—'}</td>}
                <td>{page === 'drives' ? <>{item.opens_at ? timeLabel(item.opens_at) : 'Chưa mở'}{item.closes_at && <small className="drive-row__meta">Đóng: {timeLabel(item.closes_at)}</small>}</>
                  : item.created_at ? timeLabel(item.created_at) : '—'}</td>
                <td>{item.status ? <StatusBadge status={item.status} /> : '—'}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
        {page !== 'assets' && <ListNav page={pageIndex} hasNext={Boolean(next)} loading={loading} onPrev={prevPage} onNext={() => next && setCursor(next)} count={items.length} />}
      </section>
      {(selected || showCreate) && <DetailSurface canClose={canNavigateAway} key={selected?.id || 'create'} className={`operations-detail-transition operations-management-dialog ${page === 'drives' && selected ? 'drive-detail-dialog' : ''}`} heading={selected ? recordTitle(page, selected) : createTitle} modal open={Boolean(selected) || showCreate} onClose={() => { setSelected(null); setDetail(null); setShowCreate(false); }} label={selected ? `Chi tiết ${recordTitle(page, selected)}` : createTitle}>
        {selected && !detail && <p role="status">Đang tải chi tiết…</p>}
        {selected && inlineActions && <p style={{ margin: '0 0 12px' }}>
          {string(selected.drive_title) || 'Đợt quyên góp'}{selected.donor_name ? ` · ${string(selected.donor_name)}` : ''}{selected.warehouse_name ? ` · ${string(selected.warehouse_name)}` : ''} · <StatusBadge status={string(selected.status)} />
        </p>}
        {selected && detail && !['stock', 'assets', 'drives'].includes(page) && !stockDetail && !inlineActions && <Tabs items={[
          { id: 'overview', label: 'Thông tin' },
          { id: 'details', label: page === 'reports' ? 'Số liệu' : page === 'drives' ? 'Vật phẩm tiếp nhận' : 'Chi tiết' },
          ...(showActionsTab && !inlineActions ? [{ id: 'actions', label: 'Thao tác' }] : []),
        ]} value={detailTab} onChange={setDetailTab} ariaLabel="Nội dung bản ghi" idBase="operations-detail" />}
        {selected && <div id="operations-detail-tabpanel" style={page === 'review' ? { display: 'flex', flexDirection: 'column' } : undefined}>
        {detail && (
          <>
            <div hidden={page === 'drives' || inlineActions || detailTab !== 'overview'} role="tabpanel" aria-labelledby="operations-detail-tab-overview">
            <div className="detail-grid">
              {page === 'drives' && <>
                <p><strong>Tên đợt quyên góp</strong><span className="detail-value">{string(detail.title) || 'Chưa có tên'}</span></p>
                <p><strong>Mô tả</strong><span className="detail-value">{string(detail.description) || 'Chưa có mô tả'}</span></p>
                <p><strong>Chiến dịch liên kết</strong><span className="detail-value">{detail.campaign_id ? references.campaignNames?.find(item => item.value === detail.campaign_id)?.label || `Chiến dịch mã …${string(detail.campaign_id).slice(-8)}` : 'Không liên kết chiến dịch'}{detail.campaign_id ? (() => {
                  const currentStatus = references.campaignStatuses?.find(item => item.value === detail.campaign_id)?.label;
                  return currentStatus ? ` · ${label(currentStatus)}` : detail.campaign_status ? ` · Trạng thái được ghi nhận gần nhất: ${label(detail.campaign_status)}` : '';
                })() : ''}</span></p>
                <p><strong>Thời gian dự kiến</strong><span className="detail-value">Mở: {detail.opens_at ? timeLabel(detail.opens_at) : 'Chưa đặt'} · Đóng: {detail.closes_at ? timeLabel(detail.closes_at) : 'Chưa đặt'}</span></p>
              </>}
              {page === 'assets' && <>
                {<p><strong>Tên kho</strong><span className="detail-value">{string(detail.name) || 'Chưa có tên'}</span></p>}
                {asset === 'warehouses' && <p><strong>Bán kính phục vụ</strong><span className="detail-value">{detail.service_radius_m == null ? 'Chưa khai báo' : `${Number(detail.service_radius_m).toLocaleString('vi-VN')} m`}</span></p>}
                {['address_note', 'contact_note', 'operating_note'].map(field => string(detail[field]) && <p key={field}><strong>{{ address_note: 'Ghi chú địa chỉ', contact_note: 'Thông tin liên hệ', operating_note: 'Hướng dẫn hoạt động' }[field]}</strong><span className="detail-value">{string(detail[field])}</span></p>)}
                {<p><strong>Vị trí</strong><span className="detail-value">{(() => {
                  const coordinates = (detail.location as { coordinates?: unknown[] } | null)?.coordinates;
                  return coordinates?.length === 2 && coordinates.every(value => typeof value === 'number' && Number.isFinite(value))
                    ? `Vĩ độ ${coordinates[1]} · Kinh độ ${coordinates[0]}` : 'Chưa khai báo vị trí';
                })()}</span></p>}
              </>}
              {page === 'review' && reviewTab === 'disputes' && (
                <>
                  <p>
                    <strong>Đợt quyên góp</strong>
                    <span className="detail-value">{string(detail.drive_title) || 'Chưa rõ'}</span>
                  </p>
                  <p>
                    <strong>Nội dung cần rà soát</strong>
                    <span className="detail-value">{string(detail.reason) || 'Chưa có nội dung'}</span>
                  </p>
                  {Boolean(detail.resolution_note) && (
                    <p>
                      <strong>Kết quả xử lý</strong>
                      <span className="detail-value">{string(detail.resolution_note)}</span>
                    </p>
                  )}
                </>
              )}
              {(stockDetail || page === 'reports') && (
                <>
                  <p>
                    <strong>Vật phẩm</strong>
                    <span className="detail-value">
                      {string(detail.item_name) || string((detail.item as Row | undefined)?.name) || 'Chưa có tên'}
                    </span>
                  </p>
                  <p>
                    <strong>Đơn vị</strong>
                    <span className="detail-value">
                      {itemUnitName(detail.item_id || (detail.item as Row | undefined)?.id, string(detail.unit) || string((detail.unit as Row | undefined)?.display_name) || string(detail.unit_code)) || 'Chưa có'}
                    </span>
                  </p>
                </>
              )}
              <p>
                <strong>
                  {page === 'stock'
                      ? 'Mã dòng tồn kho'
                    : page === 'intake'
                      ? 'Mã tiếp nhận'
                      : 'Mã bản ghi'}
                </strong>
                <span className="detail-value">
                  {string(selected?.id || selected?.balance_id || selected?.warehouse_id) ||
                    'Không có mã riêng'}
                </span>
              </p>
              {status && (
                <p>
                  <strong>Trạng thái</strong>
                  <span className="detail-value">
                    {label(status)}
                  </span>
                </p>
              )}
              {version != null && (
                <p>
                  <strong>Phiên bản</strong>
                  <span className="detail-value">
                    {version}
                  </span>
                </p>
              )}
              {Boolean(detail.intake_warehouse_id) && (
                <p>
                  <strong>Kho tiếp nhận</strong>
                  <span className="detail-value">
                    {warehouseName(detail.intake_warehouse_id)}
                  </span>
                </p>
              )}
              {Boolean(detail.warehouse_id) && (
                <p>
                  <strong>Kho</strong>
                  <span className="detail-value">
                    {string(detail.warehouse_name) || warehouseName(detail.warehouse_id)}
                  </span>
                </p>
              )}
              {Boolean(detail.public_code) && (
                <p>
                  <strong>Mã công khai</strong>
                  <span className="detail-value">
                    {string(detail.public_code)}
                  </span>
                </p>
              )}
              {stockDetail && detail.on_hand != null && (
                <>
                  <p>
                    <strong>Tồn thực tế</strong>
                    <span className="detail-value">
                      {quantity(detail.on_hand)}
                    </span>
                  </p>
                  <p>
                    <strong>Đã giữ</strong>
                    <span className="detail-value">
                      {quantity(detail.reserved)}
                    </span>
                  </p>
                  <p>
                    <strong>Khả dụng</strong>
                    <span className="detail-value">
                      {quantity(detail.available)}
                    </span>
                  </p>
                </>
              )}
              {!stockDetail && detail.on_hand != null && (
                <p>
                  <strong>Tồn khả dụng</strong>
                  <span className="detail-value">
                    {quantity(detail.available)} / {quantity(detail.on_hand)}
                  </span>
                </p>
              )}
              {detail.held != null && (
                <p>
                  <strong>Tạm giữ</strong>
                  <span className="detail-value">
                    {quantity(detail.held)}
                  </span>
                </p>
              )}
              {detail.delivered != null && (
                <p>
                  <strong>Đã giao</strong>
                  <span className="detail-value">
                    {quantity(detail.delivered)}
                  </span>
                </p>
              )}
            </div>
            {page === 'assets' && id && version != null && status === 'ACTIVE' && rights.has('OPERATIONS_MANAGER') &&
              command({ title: 'Ngừng sử dụng', service: 'logistics', path: `/${asset}/${id}/deactivate`, version,
                warning: 'Ngừng sử dụng tài sản hoặc địa điểm này? Các phiếu đang liên quan có thể cần xử lý trước.' })}
            </div>
            <div hidden={page !== 'drives' && !inlineActions && detailTab !== 'details'} role={page === 'drives' ? undefined : 'tabpanel'} aria-labelledby={page === 'drives' || inlineActions ? undefined : 'operations-detail-tab-details'}>
            {inlineActions && <div className="receipt-detail-summary">
              <h3>Thông tin đóng góp</h3>
              <p><strong>Đợt quyên góp:</strong> {string(detail.drive_title) || string(selected.drive_title) || 'Chưa rõ'}</p>
              <p><strong>Người đóng góp:</strong> {string(detail.donor_name) || string(selected.donor_name) || 'Chưa rõ'}</p>
              <p><strong>Kho tiếp nhận:</strong> {string(detail.warehouse_name) || string(selected.warehouse_name) || 'Chưa rõ'}</p>
              <p><strong>Trạng thái:</strong> {label(status)}</p>
            </div>}
            {page === 'drives' && <section aria-label="Vật phẩm cần tiếp nhận">
              <h3>Vật phẩm cần tiếp nhận</h3>
              {status === 'DRAFT' && id && canCreatePage && <a className="button secondary" href={`?workspace=operations&page=assets&view=warehouses&edit_drive=${encodeURIComponent(id)}`}>Chỉnh sửa bản nháp</a>}
              {driveItems.length > 0 ? <>
                <div className="operations-table-scroll" role="region" aria-label="Bảng vật phẩm cần tiếp nhận" tabIndex={0}>
                  <table className="drive-items-table">
                    <thead><tr><th scope="col">Vật phẩm</th><th scope="col">Số lượng mục tiêu</th><th scope="col">Số lượng tiếp nhận</th></tr></thead>
                    <tbody>{driveItems.slice(visibleDriveItemPage * driveItemPageSize, (visibleDriveItemPage + 1) * driveItemPageSize).map((item, index) => <tr key={string(item.item_id) || `${visibleDriveItemPage}-${index}`}>
                      <th scope="row">{string(item.item_name) || 'Vật phẩm chưa có tên'}</th>
                      <td>{quantityWithUnit(item, item.target_quantity)}</td>
                      <td>{quantityWithUnit(item, item.accepted_total ?? '0')}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
                {driveItems.length > driveItemPageSize && <nav className="pager drive-items-pager" aria-label="Phân trang vật phẩm tiếp nhận">
                  <span className="pager__info">{visibleDriveItemPage * driveItemPageSize + 1}–{Math.min((visibleDriveItemPage + 1) * driveItemPageSize, driveItems.length)} / {driveItems.length} vật phẩm · Trang {visibleDriveItemPage + 1}/{driveItemPageCount}</span>
                  <div className="pager__buttons">
                    <button type="button" className="pager__btn" disabled={visibleDriveItemPage === 0} onClick={() => setDriveItemPage(visibleDriveItemPage - 1)}>‹ Trang trước</button>
                    <button type="button" className="pager__btn" disabled={visibleDriveItemPage >= driveItemPageCount - 1} onClick={() => setDriveItemPage(visibleDriveItemPage + 1)}>Trang sau ›</button>
                  </div>
                </nav>}
              </> : <div className="empty drive-items-empty"><p>Đợt này chưa khai báo danh sách vật phẩm tiếp nhận.</p>{string(detail.description) && <p>Mô tả: {string(detail.description)}</p>}</div>}
            </section>}
            {Array.isArray(detail.lines) && (
              <div>
                <h3>Vật phẩm và số lượng</h3>
                {(detail.lines as Row[]).map((line, index) => (
                  <div className="candidate" key={string(line.id) || index}>
                    <strong>{string(line.item_name) || string(line.item_id) || 'Vật phẩm'}</strong>
                    <p>Số lượng: {lineQuantity(line, line.quantity)}</p>
                  </div>
                ))}
              </div>
            )}
            {Boolean((detail.review as Row | undefined)?.reason) && <div className="notice warning">
              <strong>{(detail.review as Row).decision === 'REQUEST_RECOUNT' ? 'Cần kiểm đếm lại' : 'Kết quả duyệt kiểm đếm'}</strong>
              <p>{string((detail.review as Row).reason)}</p>
            </div>}
            {page === 'reports' && report === 'reconciliation' && <section className="reconciliation-section"><h3>Đối soát {string((detail.item as Row)?.name)}</h3>
              <div className="operations-table-scroll" role="region" aria-label="Bảng đối soát vật phẩm" tabIndex={0}>
                <table className="reconciliation-table"><thead><tr><th scope="col">Chỉ tiêu</th><th scope="col">Số lượng ({itemUnitName((detail.item as Row)?.id, (detail.unit as Row)?.display_name)})</th></tr></thead><tbody>
                  {reconciliationMetrics.map(([key, title]) => <tr key={key}><th scope="row">{title}</th><td>{quantity(detail[key])}</td></tr>)}
                </tbody></table>
              </div><p className="reconciliation-result">{reconciliationResult(detail.flags).text}</p>
            </section>}

            {count && !(page === 'review' && reviewTab === 'receipts' && status === 'PENDING_REVIEW' && rights.has('REVIEWER') && !detail.review && !ownPendingCount) && (
              <div className="candidate">
                {status === 'POSTED' && !detail.review && <p className="notice warning" role="status">Phiếu đã ghi sổ trước đó. Lần kiểm đếm bổ sung này đang chờ duyệt độc lập; số tiếp nhận mới chưa được cộng vào tồn kho.</p>}
                <h3>{ownPendingCount && status === 'PENDING_REVIEW' ? 'Kết quả bạn đã kiểm đếm · chờ người thứ hai xác nhận' : `Kết quả kiểm đếm lần ${quantity(count.revision)}`}</h3>
                {Boolean(count.note) && <p><strong>Ghi chú kiểm đếm:</strong> {string(count.note)}</p>}
                {Array.isArray(count.lines) && count.lines.length > 0 ? (
                  <>
                    <p className="receipt-count-scroll-hint">Cuộn ngang bảng để xem đủ các cột số lượng.</p>
                    <div className="stock-table-scroll receipt-count-scroll" role="region" aria-label="Bảng kết quả kiểm đếm vật phẩm" tabIndex={0}>
                      <table className="stock-table receipt-count-table">
                        <caption>Số lượng từng vật phẩm trong lần kiểm đếm {quantity(count.revision)}</caption>
                        <thead><tr>
                          <th scope="col">Vật phẩm</th>
                          <th scope="col" className="numeric">Khai báo</th>
                          <th scope="col" className="numeric">Kiểm đếm</th>
                          <th scope="col" className="numeric">Tiếp nhận</th>
                          <th scope="col" className="numeric">Tạm giữ</th>
                          <th scope="col" className="numeric">Từ chối</th>
                        </tr></thead>
                        <tbody>{(count.lines as Row[]).filter(line => !ownPendingCount || line.has_count_line !== false).map((line, index) => (
                          <tr key={string(line.item_id) || index}>
                            <th scope="row">
                              {string(line.item_name) || string(line.item_id)}
                              {Array.isArray(line.flags) && line.flags.includes('UNEXPECTED_ITEM') && <small className="receipt-unexpected-item">Ngoài bản khai · cần rà soát</small>}
                              {Boolean(line.condition_note) && <small>Tình trạng: {string(line.condition_note)}</small>}
                              {Boolean(line.expiry_date) && <small>Hạn sử dụng: {dateLabel(line.expiry_date)}</small>}
                            </th>
                            <td className="numeric">{lineQuantity(line, line.declared_quantity)}</td>
                            <td className="numeric">{lineQuantity(line, line.counted_quantity)}</td>
                            <td className="numeric">{lineQuantity(line, line.accepted_quantity)}</td>
                            <td className="numeric">{lineQuantity(line, line.held_quantity)}</td>
                            <td className="numeric">{lineQuantity(line, line.rejected_quantity)}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </>
                ) : <p>Chưa có dòng vật phẩm trong lần kiểm đếm này.</p>}
              </div>
            )}
            {!['drives', 'reports', 'intake', 'review'].includes(page) && !Array.isArray(detail.lines) && !count && <p className="muted">Thông tin chi tiết của bản ghi được hiển thị trong tab Thông tin.</p>}
            </div>
            <div style={page === 'review' ? { order: -1 } : undefined} hidden={page === 'drives' || inlineActions ? !showActionsTab : detailTab !== 'actions'} role={page === 'drives' || inlineActions ? undefined : 'tabpanel'} aria-labelledby={page === 'drives' || inlineActions ? undefined : 'operations-detail-tab-actions'}>
            <div className="action-grid">
              {page === 'review' && reviewTab === 'receipts' && status === 'PENDING_REVIEW' && countedBefore &&
                <p className="notice" role="status">Bạn đã tham gia kiểm đếm biên nhận này. Biên nhận đang chờ một người khác xác nhận độc lập; bạn không thể xác nhận, từ chối hoặc duyệt lượt kiểm đếm.</p>}
              {page === 'drives' &&
                id &&
                version != null &&
                (rights.has('COORDINATOR') || rights.has('OPERATIONS_MANAGER')) &&
                (status === 'DRAFT' ? (
                  command({
                    title: 'Mở đợt quyên góp',
                    service: 'logistics',
                    path: `/donation-drives/${id}/open`,
                    version,
                    warning: 'Xác nhận mở đợt quyên góp?',
                  })
                ) : status === 'OPEN' ? (
                  <>
                    {command({
                      title: 'Tạm dừng đợt',
                      service: 'logistics',
                      path: `/donation-drives/${id}/pause`,
                      version,
                      fields: fields([['reason', 'Lý do tạm dừng', true]]),
                      warning: 'Tạm dừng tiếp nhận đóng góp?',
                    })}
                    {command({
                      title: 'Đóng đợt',
                      service: 'logistics',
                      path: `/donation-drives/${id}/close`,
                      version,
                      fields: fields([['reason', 'Lý do đóng', true]]),
                      warning: 'Đóng đợt quyên góp này?',
                    })}
                  </>
                ) : status === 'PAUSED' ? (
                  command({
                    title: 'Tiếp tục đợt',
                    service: 'logistics',
                    path: `/donation-drives/${id}/resume`,
                    version,
                    warning: 'Tiếp tục tiếp nhận đóng góp?',
                  })
                ) : null)}
              {canCount && selected?.id && !selected.receipt_id && selected.status === 'DECLARED' && (
                <ReceiptCountForm
                  userId={user.id}
                  key={`first-${selected.id}`}
                  receiptId=""
                  deliveryId={selected.id}
                  create={{ deliveryId: selected.id, warehouseId: string(selected.intake_warehouse_id) }}
                  driveId={string(selected.drive_id)}
                  driveTitle={string(selected.drive_title)}
                  version={0}
                  existing={null}
                  onSuccess={counted}
                />
              )}
              {page === 'intake' &&
                selected?.id &&
                selected.version != null &&
                rights.has('OPERATIONS_MANAGER') && (
                  <details className="receipt-recovery"><summary>Hỗ trợ người quyên góp mất quyền truy cập</summary><RecoveryIssue
                    key={`recovery-${selected.id}-${selected.version}`}
                    service="logistics"
                    path={`/donation-deliveries/${selected.id}/recovery`}
                    version={selected.version}
                    kind="donation"
                  /></details>
                )}
              {canCount &&
                receiptId &&
                version != null &&
                (page === 'intake' || status === 'COUNTING') &&
                !['REJECTED', 'CANCELLED'].includes(status) &&
                (status !== 'POSTED' || (Array.isArray(count?.lines) && (count.lines as Row[]).some(line => Number(line.held_quantity) > 0))) && (
                  <ReceiptCountForm
                    userId={user.id}
                    key={receiptId + version}
                    receiptId={receiptId}
                    deliveryId={string(selected.id)}
                    driveId={string(detail.drive_id)}
                    driveTitle={string(detail.drive_title)}
                    version={version}
                    heldRelease={status === 'POSTED'}
                    existing={
                      count as {
                        lines?: {
                          item_id: string;
                          counted_quantity: string;
                          accepted_quantity: string;
                          held_quantity: string;
                          rejected_quantity: string;
                        }[];
                      } | null
                    }
                    onSuccess={counted}
                  />
                )}
              {page === 'intake' && receiptId && ['REJECTED', 'CANCELLED'].includes(status) && (
                <p className="notice">Đóng góp đã {status === 'REJECTED' ? 'bị từ chối' : 'hủy'}, không thể gửi kiểm đếm mới hoặc ghi sổ.</p>
              )}
              {page === 'review' && reviewTab === 'receipts' && receiptId && count && version != null &&
                status === 'PENDING_REVIEW' && rights.has('REVIEWER') && !detail.review && !countedBefore && (
                  <ReceiptCountForm
                    userId={user.id}
                    key={`confirm-${receiptId}-${version}`}
                    receiptId={receiptId}
                    deliveryId={string(selected.id)}
                    driveId={string(detail.drive_id)}
                    driveTitle={string(detail.drive_title)}
                    version={version}
                    existing={null}
                    initialItems={Array.isArray(count.lines) ? (count.lines as Row[]).filter(line => string(line.item_id) && line.has_count_line !== false).map(line => ({
                      id: string(line.item_id), name: string(line.item_name) || string(line.item_id),
                      unit: { display_name: itemUnitName(line.item_id, line.unit_name), scale: Number(line.unit_scale ?? 0) },
                    })) : []}
                    confirm={{ countRevision: Number(count.revision), declarationRevision: Number(count.declaration_revision) }}
                    onSuccess={counted}
                  />
                )}
              {page === 'review' &&
                receiptId &&
                count &&
                version != null &&
                (['PENDING_REVIEW', 'APPROVED'].includes(status) || (status === 'POSTED' && !detail.review)) &&
                rights.has('REVIEWER') && !(status === 'PENDING_REVIEW' && countedBefore) && (
                  <>
                    {(status === 'PENDING_REVIEW' || status === 'POSTED') && <details><summary>Từ chối hoặc yêu cầu đếm lại</summary>{command({
                      title: 'Duyệt kiểm đếm',
                      hideTitle: true,
                      service: 'logistics',
                      path: `/donation-receipts/${receiptId}/review`,
                      version,
                      fields: [
                        {
                          name: 'decision',
                          label: 'Quyết định',
                          type: 'select',
                          required: true,
                          options: [
                            ...(status === 'PENDING_REVIEW' ? [] : [['APPROVE', 'Duyệt']]),
                            ['REJECT', 'Từ chối'],
                            ['REQUEST_RECOUNT', 'Yêu cầu đếm lại'],
                          ].map(([value, title]) => ({ value, label: title })),
                        },
                        { name: 'reason', label: 'Lý do', type: 'textarea', required: true, maxLength: 1000 },
                      ],
                      build: (values) => ({
                        count_revision: count.revision,
                        declaration_revision: count.declaration_revision,
                        decision: values.decision,
                        reason: values.reason,
                      }),
                      warning: 'Xác nhận quyết định duyệt độc lập cho phiên bản hiện tại?',
                    })}</details>}
                    {status === 'APPROVED' &&
                      command({
                        title: 'Ghi sổ tiếp nhận',
                        service: 'logistics',
                        path: `/donation-receipts/${receiptId}/post`,
                        version,
                        warning: 'Ghi nhận số lượng đã duyệt vào tồn kho?',
                      })}
                  </>
                )}
              {page === 'review' && receiptId && status === 'POSTED' && count && Number(count.revision) > 1 &&
                (detail.review as Row | null)?.decision === 'APPROVE' && rights.has('REVIEWER') &&
                <details><summary>Nhập bổ sung hàng tạm giữ đã được duyệt</summary>{command({
                  title: 'Nhập kho phần hàng được duyệt bổ sung', service: 'logistics',
                  path: `/donation-receipts/${receiptId}/release-held`, version,
                  fields: [{ name: 'reason', label: 'Lý do nhập bổ sung', type: 'textarea', required: true, maxLength: 1000 }],
                  build: values => ({ count_revision: count.revision, declaration_revision: count.declaration_revision, reason: values.reason }),
                  warning: 'Chỉ xác nhận khi lần kiểm đếm hiện tại đã chuyển hàng tạm giữ sang tiếp nhận và được duyệt độc lập. Phần đã ghi sổ không được cộng lại.',
                })}</details>}
              {page === 'review' &&
                reviewTab === 'disputes' &&
                id &&
                status === 'OPEN' &&
                rights.has('REVIEWER') &&
                command({
                  title: 'Giải quyết khiếu nại',
                  service: 'logistics',
                  path: `/donation-disputes/${id}/resolve`,
                  fields: [
                    {
                      name: 'resolution_note',
                      label: 'Kết quả và căn cứ xử lý',
                      type: 'textarea',
                      required: true,
                      maxLength: 2000,
                    },
                  ],
                  warning: 'Xác nhận kết quả xử lý khiếu nại? Người đóng góp sẽ được thông báo.',
                })}
            </div>
            </div>
          </>
        )}
        </div>}
        {!selected && ['intake', 'review'].includes(page) && (
          <p>Chọn bản ghi trong danh sách để xem trạng thái và thao tác thuộc quyền của bạn.</p>
        )}
        {!selected && ['overview', 'stock', 'reports'].includes(page) && (
          <p>
            Chọn một dòng để xem số liệu trả về trong phạm vi kho hoặc chiến dịch được cấp quyền. Số
            lượng được giữ theo từng đơn vị vật phẩm.
          </p>
        )}
      </DetailSurface>}
    </div>
  );
}
