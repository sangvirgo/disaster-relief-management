import { Dropdown } from '../../components/ui/Dropdown';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';
import { useCursorNav, LIST_PAGE_SIZE } from '../../api/useCursorNav';
import { ListNav } from '../../components/ui/Pager';
import { WarehouseMapManager } from './WarehouseMapManager';
import { roles, type Me } from '../../auth/session';
import { CommandForm, type CommandSpec, type Field } from '../../components/CommandForm';
import { dateLabel, label, requestStatusLabel, timeLabel } from '../../i18n/labels';
import { formatQuantity } from '../../i18n/quantity';
import { NeedReasonChips, NeedSourceBadge } from '../supply-gaps/SupplyBadges';
import { HandoffDetail } from './HandoffDetail';
import { ReceiptCountForm } from './ReceiptCountForm';
import { operationRecordKey } from './recordKey';
import { RecoveryIssue } from '../../components/RecoveryIssue';
import { DetailSurface } from '../../components/DetailSurface';
import { Tabs } from '../../components/ui/Tabs';
import { StatusBadge } from '../../components/StatusBadge';
import { useUrlView } from '../../app/useUrlView';
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
const routes: Record<string, string> = {
  overview: '/reports/stock-summary',
  drives: '/donation-drives',
  intake: '/donation-deliveries',
  review: '/donation-deliveries',
  stock: '/stock',
  assets: '/warehouses',
  needs: '/needs',
  distribution: '/distributions',
  handoff: '/distributions',
  reports: '/reports/stock-summary',
};
const headings: Record<string, string> = {
  overview: 'Tình hình vật tư',
  drives: 'Danh sách đợt quyên góp',
  intake: 'Tiếp nhận đóng góp',
  review: 'Duyệt biên nhận',
  stock: 'Tồn kho theo kho',
  assets: 'Kho',
  needs: 'Danh sách nhu cầu vật tư',
  distribution: 'Danh sách phiếu phân phối',
  handoff: 'Bàn giao vật tư',
  reports: 'Báo cáo vận hành',
};
const string = (value: unknown) => (typeof value === 'string' ? value : '');
const number = (value: unknown) => (typeof value === 'number' ? value : undefined);
const quantity = formatQuantity;
function quantityWithUnit(item: Row, value: unknown, fallbackUnit = ''): string {
  const unit = string((item.unit as Row | undefined)?.display_name) || string(item.unit_name) || fallbackUnit || string(item.unit_code);
  return `${quantity(value)}\u00a0${unit || '(chưa rõ đơn vị)'}`;
}
const distributionPages = new Set(['distribution', 'handoff']);
function recordTitle(page: string, item: Row): string {
  if (distributionPages.has(page))
    return string(item.purpose) ? label(item.purpose) : 'Phiếu phân phối';
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
function distributionItems(item: Row, itemUnits: ReferenceOptions[string] = []): string {
  const lines = Array.isArray(item.lines) ? (item.lines as Row[]) : [];
  if (!lines.length) return 'Chưa có vật phẩm';
  const first = lines[0];
  const name = string(first.item_name) || 'Vật phẩm';
  return `${name} · ${quantityWithUnit(first, first.quantity, itemUnits.find(unit => unit.value === first.item_id)?.label)}${lines.length > 1 ? ` · +${lines.length - 1} vật phẩm` : ''}`;
}
const fields = (entries: [string, string, boolean?][]) =>
  entries.map(([name, title, required]) => ({ name, label: title, required }));

function readReportFilters(userId: string): { warehouse?: string; campaign?: string } {
  try {
    const saved = JSON.parse(sessionStorage.getItem(`operations-filters:${userId}`) || '{}');
    return {
      warehouse: typeof saved?.warehouse === 'string' ? saved.warehouse : '',
      campaign: typeof saved?.campaign === 'string' ? saved.campaign : '',
    };
  } catch { return {}; }
}

export function Operations({ page, user }: { page: string; user: Me }) {
  const rights = roles(user);
  const [asset] = useUrlView('view', assetViews, 'warehouses');
  const [reviewTab, setReviewTab] = useUrlView('view', reviewViews, 'receipts');
  const [report, setReport] = useUrlView('view', reportViews, 'stock-summary');
  const [warehouse, setWarehouse] = useState(() => readReportFilters(user.id).warehouse || '');
  const [campaign, setCampaign] = useState(() => readReportFilters(user.id).campaign || '');
  const [receiptCampaign, setReceiptCampaign] = useState('');
  const [receiptWarehouse, setReceiptWarehouse] = useState('');
  const [receiptStatus, setReceiptStatus] = useState('');
  useEffect(() => { setReceiptStatus(page === 'review' ? 'PENDING_REVIEW' : ''); setCursor(''); }, [page]);
  const [seenFilters, setSeenFilters] = useState<{ campaigns: Record<string, string>; warehouses: Record<string, string> }>({ campaigns: {}, warehouses: {} });
  const initialReportFilters = useRef({ warehouse: false });
  const [items, setItems] = useState<Row[]>([]);
  const [cursor, setCursor, prevPage, pageIndex] = useCursorNav<string>('');
  useEffect(() => {
    try { sessionStorage.setItem(`operations-filters:${user.id}`, JSON.stringify({ warehouse, campaign })); }
    catch { /* Filtering remains available when browser storage is disabled. */ }
  }, [user.id, warehouse, campaign]);
  const [next, setNext] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);
  const [driveItemPage, setDriveItemPage] = useState(0);
  const [detailTab, setDetailTab] = useState('overview');
  const [lastHandoff, setLastHandoff] = useState<{ distributionId: string; id: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState<Row | null>(null);
  const driveItems = Array.isArray(detail?.items) ? detail.items as Row[] : [];
  const driveItemPageSize = 5;
  const driveItemPageCount = Math.max(1, Math.ceil(driveItems.length / driveItemPageSize));
  const visibleDriveItemPage = Math.min(driveItemPage, driveItemPageCount - 1);
  useEffect(() => setDriveItemPage(0), [selected?.id]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  // Keep request filters stable through loading/result renders and pagination.
  const reportPeriod = useMemo(() => {
    const to = Date.now();
    return { from: new Date(to - 30 * 86_400_000).toISOString(), to: new Date(to).toISOString() };
  }, [report, campaign, revision]);
  const [commitments, setCommitments] = useState<Row[]>([]);
  const [commitmentsError, setCommitmentsError] = useState('');
  const [commitmentsLoading, setCommitmentsLoading] = useState(false);
  const [references, setReferences] = useState<ReferenceOptions>({});
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
      ...(rights.has('COORDINATOR') ? [['requests', 'response', '/requests']] as const : []),
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
          .filter((item) => (key !== 'requests' || ['VERIFIED', 'TRIAGED', 'DISPATCHED', 'IN_PROGRESS'].includes(string(item.status))) && (item.id || item.code) && (!['campaigns', 'warehouses', 'items'].includes(key) || item.status === 'ACTIVE'))
          .map((item) => ({
            value: item.id!,
            label: key === 'requests'
              ? `SOS ${string(item.tracking_code) || item.id!.slice(0, 8)} · ${requestStatusLabel(string(item.status))}`
              : string(item.name) || string(item.title) || string(item.identifier) ||
                string(item.item_name) || `Mã …${item.id!.slice(-8)}`,
          }));
      });
      if (!options.warehouses?.length) {
        const driveResult = results[3];
        if (driveResult.status === 'fulfilled') {
          options.driveWarehouses = driveResult.value
            .filter((drive) => drive.id && string(drive.intake_warehouse_id))
            .map((drive) => ({ value: drive.id!, label: string(drive.intake_warehouse_id) }));
          const byWarehouse = new Map<string, string>();
          for (const drive of driveResult.value) {
            const warehouseId = string(drive.intake_warehouse_id);
            if (warehouseId && !byWarehouse.has(warehouseId)) {
              byWarehouse.set(warehouseId, `Kho tiếp nhận · …${warehouseId.slice(-8)}`);
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
  useEffect(() => {
    if (page !== 'distribution' && page !== 'needs') return;
    if (!rights.has('OPERATIONS_MANAGER') && !rights.has('COORDINATOR')) return;
    let live = true;
    setCommitmentsLoading(true);
    setCommitmentsError('');
    const load = async () => {
      const needs = await fetchAll<Row>('logistics', '/needs');
      const eligible = needs.filter((need) => need.status !== 'CANCELLED' && Number(need.committed_reserved) > 0);
      const all: Row[] = [];
      for (let start = 0; start < eligible.length; start += 4) {
        const batches = await Promise.all(eligible.slice(start, start + 4).map(async (need) => {
          const contributions = await fetchAll<Row>('logistics', '/needs/' + need.id + '/contributions');
          return contributions.filter((item) => Number(item.reserved_remaining) > 0).map((item) => ({
            ...item, need_id: need.id, request_id: need.request_id,
            item_id: (need.item as Row)?.id, item_name: (need.item as Row)?.name,
            unit_name: (need.unit as Row)?.display_name, unit_scale: (need.unit as Row)?.scale,
          }));
        }));
        all.push(...batches.flat());
      }
      if (live) setCommitments(all);
    };
    void load().catch((cause) => { if (live) { setCommitments([]); setCommitmentsError(cause instanceof Error ? cause.message : 'Không thể tải cam kết xuất kho.'); } })
      .finally(() => { if (live) setCommitmentsLoading(false); });
    return () => { live = false; };
  }, [page, revision, user.id]);
  const warehouseOptions = [...(references.warehouses || [])];
  const campaignOptions = references.campaignNames || [];
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
  const referenceField = (
    name: string,
    title: string,
    source: string,
    required = false
  ): Field => ({
    name,
    label: title,
    type: 'reference',
    required,
    options: source === 'warehouses' ? warehouseOptions : references[source] || [],
    placeholder: `Dán mã ${title.toLocaleLowerCase('vi-VN')}`,
  });
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
  if (page === 'reports' && report === 'fulfillment' && campaign) {
    params.set('campaign_id', campaign);
    params.set('from', reportPeriod.from);
    params.set('to', reportPeriod.to);
  }
  const path = route + (params.size ? `?${params}` : '');
  const ready = !(
    page === 'reports' &&
    ((report === 'reconciliation' && !warehouse) || (report === 'fulfillment' && !campaign))
  );
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
        : (page === 'distribution' || page === 'handoff') && selected.id
          ? `/distributions/${selected.id}`
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
      || ((distributionPages.has(page) || page === 'assets' || page === 'drives' || page === 'needs' || (page === 'review' && reviewTab === 'disputes')) && selected?.id);
    if (!keepDetail) setSelected(null);
    setDetail(null);
    setDetailTab('overview');
    setShowCreate(false);
    setRevision((value) => value + 1);
  }
  function command(spec: CommandSpec) {
    return (
      <CommandForm key={spec.path + String(spec.version ?? '')} spec={spec} onSuccess={(result) => { const record = result as Row | undefined; if (spec.path.endsWith('/handoffs') && record?.id && selected?.id) { setLastHandoff({ distributionId: selected.id, id: record.id }); setRevision((value) => value + 1); } else done(); }} onStale={() => setRevision((value) => value + 1)} />
    );
  }
  const id = detail?.id;
  const version = number(detail?.version);
  const status = string(detail?.delivery_status || detail?.status);
  const distributionActionAvailable = Boolean(id && version != null && detail && (
    (status === 'DRAFT' && (
      detail.preparer_user_id === user.id ||
      (detail.preparer_user_id !== user.id && (rights.has('REVIEWER') || rights.has('OPERATIONS_MANAGER'))) ||
      detail.approver_user_id === user.id
    )) ||
    (status === 'APPROVED' && (
      detail.approver_user_id === user.id ||
      (detail.approver_user_id !== user.id && rights.has('OPERATIONS_MANAGER')) ||
      detail.preparer_user_id === user.id
    )) ||
    (status === 'DISPATCHED' && (
      detail.dispatch_actor_user_id === user.id ||
      (Array.isArray(detail.lines) && (detail.lines as Row[]).every((line) => Number(line.in_transit) === 0 && Number(line.pending_loss_count) === 0) &&
        (rights.has('REVIEWER') || rights.has('OPERATIONS_MANAGER'))) ||
      (page === 'distribution' && detail.dispatch_actor_user_id !== user.id && Array.isArray(detail.lines) &&
        rights.has('OPERATIONS_MANAGER'))
    ))
  ));
  const showActionsTab = page === 'drives'
    ? ['DRAFT', 'OPEN', 'PAUSED'].includes(status) && (rights.has('COORDINATOR') || rights.has('OPERATIONS_MANAGER'))
    : page === 'needs' ? status !== 'CANCELLED' && (rights.has('OPERATIONS_MANAGER') || rights.has('COORDINATOR'))
      : distributionPages.has(page) ? distributionActionAvailable
        : page === 'intake' ? rights.has('OPERATIONS_MANAGER')
          : page === 'review' ? rights.has('REVIEWER') : false;
  const inlineActions = page === 'intake' || page === 'review';
  const stockDetail = page === 'stock' || (page === 'reports' && report === 'stock-summary');
  const needScale = number((detail?.unit as Row | undefined)?.scale);
  const needStep = 10 ** -(needScale ?? 0);
  const needMinimum = Math.max(needStep, Number(detail?.delivered || 0) + Number(detail?.committed_reserved || 0) + Number(detail?.issued_unsettled || 0));
  const needUncommitted = Number(detail?.requested || 0) - Number(detail?.delivered || 0) - Number(detail?.committed_reserved || 0) - Number(detail?.issued_unsettled || 0);
  const receiptId =
    page === 'intake' || (page === 'review' && reviewTab === 'receipts')
      ? string(selected?.receipt_id)
      : '';
  const count = detail?.count as Row | null | undefined;
  const canCount = (page === 'intake' && rights.has('OPERATIONS_MANAGER')) ||
    (page === 'review' && reviewTab === 'receipts' && rights.has('REVIEWER'));
  const needCreate: CommandSpec = {
    title: 'Ghi nhận nhu cầu',
    hideTitle: true,
    service: 'logistics',
    path: '/needs',
    fields: [
      { ...referenceField('request_id', 'Mã nội bộ yêu cầu SOS', 'requests', true),
        hintFor: () => 'Điều phối viên lấy mã này từ URL chi tiết SOS và gửi cùng lần xử lý hiện tại. Mã theo dõi SOS của người dân không thay thế được mã nội bộ.' },
      { name: 'item_id', label: 'Vật phẩm', type: 'choice-cards', required: true, searchable: true, options: references.items || [] },
      ...(!rights.has('COORDINATOR') ? [{ name: 'work_cycle', label: 'Lần xử lý SOS', type: 'number' as const, required: true, integer: true,
        hintFor: () => 'Lần xử lý bắt đầu từ 1 và tăng khi SOS đã kết thúc được mở lại. Hãy lấy số hiện tại từ điều phối viên để gắn nhu cầu vào đúng lần xử lý.' }] : []),
      { name: 'quantity', label: 'Số lượng cần', type: 'number', required: true,
        scaleFor: (values) => { const unit = references.itemScales?.find(item => item.value === values.item_id); return unit ? Number(unit.label) : undefined; } },
    ],
    build: async (values) => {
      const request = rights.has('COORDINATOR') ? await api<Row>('response', '/requests/' + values.request_id) : null;
      if (request && !['VERIFIED', 'TRIAGED', 'DISPATCHED', 'IN_PROGRESS'].includes(string(request.status))) throw new Error('SOS chưa được xác minh hoặc đã kết thúc; không thể tạo nhu cầu mới.');
      const workCycle = request ? Number(request.work_cycle) : Number(values.work_cycle);
      if (!Number.isInteger(workCycle) || workCycle < 1) throw new Error('Không lấy được chu kỳ xử lý hiện tại. Hãy cập nhật hồ sơ SOS rồi thử lại.');
      return { request_id: values.request_id, work_cycle: workCycle, item_id: values.item_id, quantity: values.quantity };
    },
  };
  const canCreatePage =
    (page === 'drives' && (rights.has('COORDINATOR') || rights.has('OPERATIONS_MANAGER'))) ||
    (page === 'needs' && (rights.has('OPERATIONS_MANAGER') || rights.has('COORDINATOR'))) ||
    (page === 'distribution' &&
      rights.has('OPERATIONS_MANAGER'));
  const createTitle = page === 'drives' ? 'Tạo đợt thủ công' : page === 'needs' ? 'Ghi nhận nhu cầu' :
    page === 'assets' ? 'Thêm kho' :
    'Tạo phiếu phân phối';
  useEffect(() => { setShowCreate(false); }, [page, asset]);
  return (
    <div className="operations-workspace">
      <section className="card">
        <div className="section-header list-action-header">
          <h2>{page === 'review' && reviewTab === 'disputes' ? 'Xử lý khiếu nại' : headings[page]}</h2>
          <div className="list-header-actions">
            <button type="button" className="button secondary" disabled={loading} onClick={() => { setCursor(''); setRevision((value) => value + 1); }}>Cập nhật</button>
            {canCreatePage && <button type="button" className="button primary list-create-button" onClick={() => { setSelected(null); setDetail(null); setShowCreate(true); }}>{createTitle}</button>}
          </div>
        </div>
        {page === 'assets' && asset === 'warehouses' && <WarehouseMapManager
          canManage={rights.has('OPERATIONS_MANAGER')} canManageDrives={rights.has('OPERATIONS_MANAGER') || rights.has('COORDINATOR')}
          warehouseOptions={warehouseOptions} campaigns={references.campaigns || []} items={references.items || []} itemScales={references.itemScales || []}
          refreshKey={revision} onChanged={() => setRevision((value) => value + 1)} />}
        {page === 'review' && (
          <div className="tabs">
            <button
              className={reviewTab === 'receipts' ? 'active' : ''}
              onClick={() => {
                setReviewTab('receipts');
                setCursor('');
                setSelected(null);
              }}
            >
              Biên nhận
            </button>
            <button
              className={reviewTab === 'disputes' ? 'active' : ''}
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
          <div className="filter-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', margin: '12px 0' }}>
            {page === 'review' && (
              <div className="tabs" style={{ gridColumn: '1 / -1', margin: 0 }} role="group" aria-label="Việc cần làm">
                {([['DECLARED', 'Cần đếm'], ['PENDING_REVIEW', 'Cần xác nhận'], ['', 'Tất cả']] as const).map(([value, title]) => (
                  <button key={value} type="button" className={receiptStatus === value ? 'active' : ''}
                    onClick={() => { setReceiptStatus(value); setCursor(''); setSelected(null); setDetail(null); }}>{title}</button>
                ))}
              </div>
            )}
            {(receiptCampaign || receiptWarehouse || receiptStatus) && (
              <div className="receipt-filter-actions"><button type="button" className="button secondary clear-receipt-filters" onClick={() => { setReceiptCampaign(''); setReceiptWarehouse(''); setReceiptStatus(''); setCursor(''); setSelected(null); }}>Xóa bộ lọc</button></div>
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
          </div>
        )}
        {page === 'reports' && (
          <>
            <div className="tabs">
              {(
                [
                  ['stock-summary', 'Tồn kho'],
                  ['fulfillment', 'Tiến độ hỗ trợ'],
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
            {report === 'fulfillment' && (
              <label className="filter">
                Chiến dịch trong 30 ngày gần đây
                <Dropdown
                  value={campaign}
                  onChange={(event) => {
                    setCampaign(event.target.value);
                    setCursor('');
                    setSelected(null);
                    setDetail(null);
                  }}
                >
                  <option value="">Chọn chiến dịch</option>
                  {campaignOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
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
            <div className="stock-table-scroll">
              <table className="stock-table">
                <thead>
                  <tr>
                    <th>Vật phẩm</th>
                    <th>Kho</th>
                    <th>Đơn vị</th>
                    <th className="numeric">Tồn thực tế</th>
                    <th className="numeric">Đã giữ</th>
                    <th className="numeric">Khả dụng</th>
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
                      </th>
                      <td>
                        {string(item.warehouse_name) ||
                          (item.warehouse_id ? warehouseName(item.warehouse_id) : '—')}
                      </td>
                      <td>
                        {string((item.unit as Row | undefined)?.display_name) ||
                          string(item.unit) ||
                          string(item.unit_name) ||
                          '—'}
                      </td>
                      <td className="numeric">{quantity(item.on_hand)}</td>
                      <td className="numeric">{quantity(item.reserved)}</td>
                      <td className="numeric">
                        <strong className="available-value">{quantity(item.available)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : page === 'assets' ? null : (
          <div className="operations-table-scroll" role="region" aria-label={`Bảng ${headings[page] || 'bản ghi'}`} tabIndex={0}>
            <table className={`operations-record-table${page === 'drives' ? ' operations-record-table--drives' : ''}`}>
              <thead><tr><th scope="col">{page === 'assets' ? 'Kho' : 'Tên bản ghi'}</th>{page !== 'assets' && page !== 'drives' && <th scope="col">Thông tin chính</th>}<th scope="col">Thời gian</th><th scope="col">Trạng thái</th></tr></thead>
              <tbody>{items.map((item) => <tr key={operationRecordKey(item)}>
                <th scope="row">{page === 'assets' && asset === 'warehouses' && item.id
                  ? <a className="table-row-link" href={`?workspace=operations&page=assets&view=warehouses&warehouse_id=${encodeURIComponent(item.id)}&warehouse_name=${encodeURIComponent(recordTitle(page, item))}`} aria-label={`Xem tồn kho ${recordTitle(page, item)}`}>{recordTitle(page, item)}</a>
                  : <button type="button" className="table-row-link" onClick={() => { setDetailTab('overview'); setSelected(item); }}>{recordTitle(page, item)}</button>}{page === 'needs' && <span className="supply-table-cell-stack"><NeedSourceBadge source={item.source} /><NeedReasonChips codes={item.reason_codes} /></span>}</th>
                {page !== 'assets' && page !== 'drives' && <td>{distributionPages.has(page) ? distributionItems(item, references.itemUnits)
                  : item.requested != null ? `Cần ${quantityWithUnit(item, item.requested)} · Đã giao ${quantityWithUnit(item, item.delivered)}`
                  : item.active_requested != null ? `Cần ${quantityWithUnit(item, item.active_requested)} · Đã giao ${quantityWithUnit(item, item.delivered)}`
                  : item.drive_title ? string(item.drive_title)
                  : item.warehouse_name ? string(item.warehouse_name)
                  : item.donor_name ? `Người đóng góp: ${string(item.donor_name)}`
                  : item.receipt_id ? 'Đã lập biên nhận' : '—'}</td>}
                <td>{item.created_at ? timeLabel(item.created_at) : '—'}</td>
                <td>{item.status ? <StatusBadge status={item.status} /> : '—'}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
        {page !== 'assets' && <ListNav page={pageIndex} hasNext={Boolean(next)} loading={loading} onPrev={prevPage} onNext={() => next && setCursor(next)} count={items.length} />}
      </section>
      {page === 'distribution' && commitmentsError && <p role="alert" className="notice error">{commitmentsError} Hãy tải lại trước khi lập phiếu hỗ trợ SOS.</p>}
      {(selected || showCreate) && <DetailSurface key={selected?.id || 'create'} className={`operations-detail-transition operations-management-dialog ${page === 'drives' && selected ? 'drive-detail-dialog' : ''} ${distributionPages.has(page) && !showCreate ? 'distribution-detail-panel' : ''}`} heading={selected ? recordTitle(page, selected) : createTitle} modal open={Boolean(selected) || showCreate} onClose={() => { setSelected(null); setDetail(null); setShowCreate(false); }} label={selected ? `Chi tiết ${recordTitle(page, selected)}` : createTitle}>
        {selected && !detail && <p role="status">Đang tải chi tiết…</p>}
        {selected && inlineActions && <p style={{ margin: '0 0 12px' }}>
          {string(selected.drive_title) || 'Đợt quyên góp'}{selected.donor_name ? ` · ${string(selected.donor_name)}` : ''}{selected.warehouse_name ? ` · ${string(selected.warehouse_name)}` : ''} · <StatusBadge status={string(selected.status)} />
        </p>}
        {selected && detail && !['stock', 'assets', 'drives'].includes(page) && !inlineActions && <Tabs items={[
          { id: 'overview', label: 'Thông tin' },
          { id: 'details', label: page === 'reports' ? 'Số liệu' : page === 'needs' ? 'Cam kết xuất kho' : page === 'drives' ? 'Vật phẩm tiếp nhận' : 'Chi tiết' },
          ...(showActionsTab && !inlineActions ? [{ id: 'actions', label: 'Thao tác' }] : []),
          ...(distributionPages.has(page) ? [{ id: 'handoff', label: 'Bàn giao' }] : []),
        ]} value={detailTab} onChange={setDetailTab} ariaLabel="Nội dung bản ghi" idBase="operations-detail" />}
        {selected && <div id="operations-detail-tabpanel" style={page === 'review' ? { display: 'flex', flexDirection: 'column' } : undefined}>
        {distributionPages.has(page) && selected.id && <div hidden={detailTab !== 'handoff'} role="tabpanel" aria-labelledby="operations-detail-tab-handoff"><HandoffDetail key={selected.id + (lastHandoff?.distributionId === selected.id ? lastHandoff.id : '')} distributionId={selected.id} initialId={lastHandoff?.distributionId === selected.id ? lastHandoff.id : undefined} canReview={rights.has('REVIEWER') || rights.has('OPERATIONS_MANAGER')} userId={user.id} onChanged={() => setRevision((value) => value + 1)} /></div>}
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
                      {string(detail.unit) || string((detail.unit as Row | undefined)?.display_name) || string(detail.unit_code) || 'Chưa có'}
                    </span>
                  </p>
                </>
              )}
              {page === 'reports' && report === 'fulfillment' && <>
                <p><strong>Nhu cầu hiện hành</strong><span className="detail-value">{quantityWithUnit(detail, detail.active_requested)}</span></p>
                <p><strong>Còn thiếu hiện hành</strong><span className="detail-value">{quantityWithUnit(detail, detail.active_outstanding)}</span></p>
                {detail.status === 'CANCELLED' && <p className="notice">Nhu cầu đã hủy không còn được tính vào lượng cần đáp ứng hiện hành. Số đã giao vẫn được giữ lại để đối chiếu lịch sử.</p>}
              </>}
              {distributionPages.has(page) && status === 'DISPATCHED' && <p className="notice">Phiếu tự đối soát khi hết hàng đang vận chuyển, hàng tại điểm và không còn thất thoát chờ duyệt.</p>}
              {page === 'needs' && <><p><strong>Yêu cầu SOS</strong><span className="detail-value">{references.requests?.find((item) => item.value === detail.request_id)?.label || string(detail.request_id)}</span></p><p><strong>Nhu cầu</strong><span className="detail-value">{quantityWithUnit(detail, detail.requested)} · Đã giao {quantityWithUnit(detail, detail.delivered)}</span></p><p><strong>Nguồn nhu cầu</strong><span className="detail-value"><NeedSourceBadge source={detail.source} /></span></p><NeedReasonChips codes={detail.reason_codes} all /></>}
              {distributionPages.has(page) && Boolean(detail.purpose) && (
                <p>
                  <strong>Mục đích phân phối</strong>
                  <span className="detail-value">
                    {label(detail.purpose)}
                  </span>
                </p>
              )}
              <p>
                <strong>
                  {distributionPages.has(page)
                    ? 'Mã phiếu phân phối'
                    : page === 'stock'
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
              {detail.in_transit != null && (
                <p>
                  <strong>Đang vận chuyển</strong>
                  <span className="detail-value">
                    {quantity(detail.in_transit)}
                  </span>
                </p>
              )}
              {detail.delivered != null && (
                <p>
                  <strong>Đã giao</strong>
                  <span className="detail-value">
                    {page === 'needs' ? quantityWithUnit(detail, detail.delivered) : quantity(detail.delivered)}
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
              {driveItems.length > 0 ? <>
                <div className="operations-table-scroll" role="region" aria-label="Bảng vật phẩm cần tiếp nhận" tabIndex={0}>
                  <table className="drive-items-table">
                    <thead><tr><th scope="col">Vật phẩm</th><th scope="col">Số lượng mục tiêu</th><th scope="col">Hướng dẫn tiếp nhận</th></tr></thead>
                    <tbody>{driveItems.slice(visibleDriveItemPage * driveItemPageSize, (visibleDriveItemPage + 1) * driveItemPageSize).map((item, index) => <tr key={string(item.item_id) || `${visibleDriveItemPage}-${index}`}>
                      <th scope="row">{string(item.item_name) || 'Vật phẩm chưa có tên'}</th>
                      <td>{quantityWithUnit(item, item.target_quantity)}</td>
                      <td>{string(item.acceptance_note) ? <details className="drive-item-note"><summary>Xem hướng dẫn</summary><p>{string(item.acceptance_note)}</p></details> : '—'}</td>
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
                    <p>
                      Số lượng: {lineQuantity(line, line.quantity)} · Đã giao: {lineQuantity(line, line.handed_out)} ·
                      Đang vận chuyển: {lineQuantity(line, line.in_transit)} · Đã hoàn: {lineQuantity(line, line.returned)} · Hao hụt đã duyệt: {lineQuantity(line, line.lost)}
                      {Number(line.pending_loss_count) > 0 && ' · Có thất thoát chờ duyệt'}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {Boolean((detail.review as Row | undefined)?.reason) && <div className="notice warning">
              <strong>{(detail.review as Row).decision === 'REQUEST_RECOUNT' ? 'Cần kiểm đếm lại' : 'Kết quả duyệt kiểm đếm'}</strong>
              <p>{string((detail.review as Row).reason)}</p>
            </div>}
            {page === 'needs' && <section><h3>Cam kết xuất kho hiện có</h3>
              {commitmentsLoading && <p role="status">Đang tải cam kết…</p>}
              {commitmentsError && <p role="alert" className="notice error">{commitmentsError}</p>}
              {commitments.filter((item) => item.need_id === id).map((item) => <div className="candidate" key={item.id}>
                <strong>{string(item.warehouse_name)}</strong>
                <p>Còn có thể xuất: {quantity(item.reserved_remaining)} {string(item.unit_name)}</p>
                <p>Mã cam kết: {item.id}</p>
              </div>)}
              {!commitmentsLoading && !commitmentsError && !commitments.some((item) => item.need_id === id) && <p>Chưa có cam kết còn số lượng để xuất kho.</p>}
            </section>}
            {page === 'reports' && report === 'reconciliation' && <section className="reconciliation-section"><h3>Đối soát {string((detail.item as Row)?.name)}</h3>
              <div className="operations-table-scroll" role="region" aria-label="Bảng đối soát vật phẩm" tabIndex={0}>
                <table className="reconciliation-table"><thead><tr><th scope="col">Chỉ tiêu</th><th scope="col">Số lượng ({string((detail.unit as Row)?.display_name)})</th></tr></thead><tbody>
                  {Object.entries({ intake_accepted: 'Đã tiếp nhận', posted_movements: 'Tồn theo sổ', posted_reserved_movements: 'Giữ chỗ theo sổ', reserved: 'Đang giữ chỗ', issued_in_transit: 'Đang vận chuyển', delivered: 'Đã giao', returned: 'Đã hoàn trả', lost: 'Hao hụt' }).map(([key, title]) => <tr key={key}><th scope="row">{title}</th><td>{quantity(detail[key])}</td></tr>)}
                </tbody></table>
              </div><p className="reconciliation-result">{Object.values((detail.flags as Row) || {}).some(Boolean) ? 'Có chênh lệch cần rà soát giữa sổ kho và các cam kết.' : 'Chưa ghi nhận chênh lệch đối soát.'}</p>
            </section>}
            {page === 'reports' && report === 'fulfillment' && <p className="muted">So sánh số lượng đang cần với số đã giao và số còn thiếu ở tab Thông tin. Số liệu này phản ánh phạm vi và thời gian báo cáo đã chọn.</p>}
            {page === 'reports' && report === 'stock-summary' && <p className="muted">Số lượng tồn thực tế, đã giữ và có thể xuất được hiển thị ở tab Thông tin.</p>}
            {count && (
              <div className="candidate">
                {status === 'POSTED' && !detail.review && <p className="notice warning" role="status">Phiếu đã ghi sổ trước đó. Lần kiểm đếm bổ sung này đang chờ duyệt độc lập; số tiếp nhận mới chưa được cộng vào tồn kho.</p>}
                <h3>Kết quả kiểm đếm lần {quantity(count.revision)}</h3>
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
                        <tbody>{(count.lines as Row[]).map((line, index) => (
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
            {!['drives', 'needs', 'reports', 'distribution', 'handoff', 'intake', 'review'].includes(page) && !Array.isArray(detail.lines) && !count && <p className="muted">Thông tin chi tiết của bản ghi được hiển thị trong tab Thông tin.</p>}
            </div>
            <div style={page === 'review' ? { order: -1 } : undefined} hidden={page === 'drives' || inlineActions ? !showActionsTab : detailTab !== 'actions'} role={page === 'drives' || inlineActions ? undefined : 'tabpanel'} aria-labelledby={page === 'drives' || inlineActions ? undefined : 'operations-detail-tab-actions'}>
            <div className="action-grid">
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
                  key={`first-${selected.id}`}
                  receiptId=""
                  deliveryId={selected.id}
                  create={{ deliveryId: selected.id, warehouseId: string(selected.intake_warehouse_id) }}
                  driveId={string(selected.drive_id)}
                  driveTitle={string(selected.drive_title)}
                  version={0}
                  existing={null}
                  onSuccess={done}
                />
              )}
              {page === 'intake' &&
                selected?.id &&
                selected.version != null &&
                rights.has('OPERATIONS_MANAGER') && (
                  <RecoveryIssue
                    key={`recovery-${selected.id}-${selected.version}`}
                    service="logistics"
                    path={`/donation-deliveries/${selected.id}/recovery`}
                    version={selected.version}
                    kind="donation"
                  />
                )}
              {canCount &&
                receiptId &&
                version != null &&
                (page === 'intake' || status === 'COUNTING') &&
                !['REJECTED', 'CANCELLED'].includes(status) &&
                (status !== 'POSTED' || (Array.isArray(count?.lines) && (count.lines as Row[]).some(line => Number(line.held_quantity) > 0))) && (
                  <ReceiptCountForm
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
                    onSuccess={done}
                  />
                )}
              {page === 'intake' && receiptId && ['REJECTED', 'CANCELLED'].includes(status) && (
                <p className="notice">Đóng góp đã {status === 'REJECTED' ? 'bị từ chối' : 'hủy'}, không thể gửi kiểm đếm mới hoặc ghi sổ.</p>
              )}
              {page === 'review' && reviewTab === 'receipts' && receiptId && count && version != null &&
                status === 'PENDING_REVIEW' && rights.has('REVIEWER') && !detail.review && (
                  <ReceiptCountForm
                    key={`confirm-${receiptId}-${version}`}
                    receiptId={receiptId}
                    deliveryId={string(selected.id)}
                    driveId={string(detail.drive_id)}
                    driveTitle={string(detail.drive_title)}
                    version={version}
                    existing={null}
                    confirm={{ countRevision: Number(count.revision), declarationRevision: Number(count.declaration_revision) }}
                    onSuccess={done}
                  />
                )}
              {page === 'review' &&
                receiptId &&
                count &&
                version != null &&
                (['PENDING_REVIEW', 'APPROVED'].includes(status) || (status === 'POSTED' && !detail.review)) &&
                rights.has('REVIEWER') && (
                  <>
                    {(status === 'PENDING_REVIEW' || status === 'POSTED') && <details><summary>Từ chối hoặc yêu cầu đếm lại</summary>{command({
                      title: 'Duyệt kiểm đếm',
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
                            ['APPROVE', 'Duyệt'],
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
                command({
                  title: 'Nhập kho phần hàng được duyệt bổ sung', service: 'logistics',
                  path: `/donation-receipts/${receiptId}/release-held`, version,
                  fields: [{ name: 'reason', label: 'Lý do nhập bổ sung', type: 'textarea', required: true, maxLength: 1000 }],
                  build: values => ({ count_revision: count.revision, declaration_revision: count.declaration_revision, reason: values.reason }),
                  warning: 'Chỉ xác nhận khi lần kiểm đếm hiện tại đã chuyển hàng tạm giữ sang tiếp nhận và được duyệt độc lập. Phần đã ghi sổ không được cộng lại.',
                })}
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
              {page === 'needs' &&
                id &&
                version != null &&
                (rights.has('OPERATIONS_MANAGER') || rights.has('COORDINATOR')) &&
                status !== 'CANCELLED' && (
                  <>
                    {command({
                      title: 'Tăng số lượng cần',
                      service: 'logistics',
                      path: `/needs/${id}/increase`,
                      version,
                      fields: [
                        {
                          name: 'quantity',
                          label: 'Tổng số lượng mới',
                          type: 'number',
                          required: true,
                          min: Number(detail.requested) + needStep,
                          scaleFor: () => { const scale = (detail.unit as Row | undefined)?.scale; return scale == null ? undefined : Number(scale); },
                        },
                        { name: 'reason', label: 'Lý do', type: 'textarea', required: true },
                      ],
                      build: (values) => ({ quantity: values.quantity, reason: values.reason }),
                    })}
                    {status !== 'FULFILLED' && needMinimum < Number(detail.requested) && command({
                      title: 'Giảm số lượng cần',
                      service: 'logistics',
                      path: `/needs/${id}/reduce`,
                      version,
                      fields: [
                        {
                          name: 'quantity',
                          label: 'Tổng số lượng mới',
                          type: 'number',
                          required: true,
                          min: needMinimum,
                          max: Number(detail.requested) - needStep,
                          scaleFor: () => { const scale = (detail.unit as Row | undefined)?.scale; return scale == null ? undefined : Number(scale); },
                        },
                        { name: 'reason', label: 'Lý do', type: 'textarea', required: true },
                      ],
                      build: (values) => ({ quantity: values.quantity, reason: values.reason }),
                      warning: 'Xác nhận giảm nhu cầu theo số lượng còn đủ điều kiện?',
                    })}
                    {status !== 'FULFILLED' && command({
                      title: 'Hủy phần nhu cầu còn lại',
                      service: 'logistics',
                      path: `/needs/${id}/cancel`,
                      version,
                      fields: [
                        { name: 'reason', label: 'Lý do hủy', type: 'textarea', required: true },
                      ],
                      warning: 'Xác nhận hủy phần nhu cầu chưa được giao?',
                    })}
                    {status !== 'FULFILLED' && needUncommitted <= 0 && <p className="notice">Số lượng còn lại đã được giữ hoặc đang giao; chưa thể cam kết thêm hay giảm xuống dưới phần đã phân bổ.</p>}
                    {status !== 'FULFILLED' && needUncommitted > 0 && rights.has('OPERATIONS_MANAGER') &&
                      command({
                        title: 'Cam kết xuất kho',
                        service: 'logistics',
                        path: `/needs/${id}/commitments`,
                        fields: [
                          referenceField('warehouse_id', 'Kho xuất hàng', 'warehouses', true),
                          { name: 'quantity', label: 'Số lượng', type: 'number', required: true,
                            max: needUncommitted,
                            scaleFor: () => { const scale = (detail.unit as Row | undefined)?.scale; return scale == null ? undefined : Number(scale); } },
                        ],
                        build: (values) => ({
                          warehouse_id: values.warehouse_id,
                          quantity: values.quantity,
                        }),
                      })}
                  </>
                )}
              {['distribution', 'handoff'].includes(page) && id && version != null && (
                <>
                  {status === 'DRAFT' && detail.preparer_user_id === user.id &&
                    <p className="notice">Phiếu đang chờ người có quyền duyệt khác người lập phiếu kiểm tra và phê duyệt.</p>}
                  {status === 'APPROVED' && detail.approver_user_id === user.id &&
                    <p className="notice">Phiếu đã được duyệt. Nhân viên tiếp nhận hoặc phân phối khác người duyệt cần xác nhận xuất kho.</p>}
                  {status === 'DISPATCHED' && detail.dispatch_actor_user_id === user.id &&
                    <p className="notice">Bạn đã xác nhận xuất kho. Việc nhận hàng hoặc hoàn kho cần được một nhân viên khác ghi nhận để đối soát độc lập.</p>}
                  {status === 'DRAFT' &&
                    detail.preparer_user_id !== user.id &&
                    (rights.has('REVIEWER') || rights.has('OPERATIONS_MANAGER')) &&
                    command({
                      title: 'Duyệt phiếu phân phối',
                      service: 'logistics',
                      path: `/distributions/${id}/approve`,
                      version,
                      warning: 'Xác nhận duyệt phiếu phân phối?',
                    })}
                  {status === 'APPROVED' &&
                    detail.approver_user_id !== user.id &&
                    rights.has('OPERATIONS_MANAGER') &&
                    command({
                      title: 'Xuất kho',
                      service: 'logistics',
                      path: `/distributions/${id}/dispatch`,
                      version,
                      warning: 'Kiểm tra hàng thực tế và xác nhận xuất kho?',
                    })}
                  {status === 'DRAFT' &&
                    detail.purpose === 'REQUEST_AID' &&
                    detail.preparer_user_id === user.id &&
                    rights.has('OPERATIONS_MANAGER') &&
                    <>
                      <p>
                        Thao tác này lấy mọi cam kết còn hiệu lực trong cùng kho, kể cả
                        cam kết của yêu cầu SOS khác. Kiểm tra các dòng hàng trước khi duyệt.
                      </p>
                      {command({
                        title: 'Chuẩn bị từ cam kết',
                        service: 'logistics',
                        path: `/distributions/${id}/prepare-from-commitments`,
                        version,
                        warning:
                          'Thay các dòng phiếu bằng mọi cam kết còn hiệu lực trong cùng kho, kể cả từ SOS khác?',
                      })}
                    </>}
                  {['DRAFT', 'APPROVED'].includes(status) &&
                    (detail.preparer_user_id === user.id || detail.approver_user_id === user.id) &&
                    command({
                      title: 'Hủy phiếu',
                      service: 'logistics',
                      path: `/distributions/${id}/cancel`,
                      version,
                      warning: 'Xác nhận hủy phiếu phân phối trước khi xuất kho?',
                    })}
                  {status === 'DISPATCHED' && Array.isArray(detail.lines) && (detail.lines as Row[]).every((line) => Number(line.in_transit) === 0 && Number(line.pending_loss_count) === 0) &&
                    (rights.has('REVIEWER') || rights.has('OPERATIONS_MANAGER')) &&
                    command({
                      title: 'Đối soát phiếu',
                      service: 'logistics',
                      path: `/distributions/${id}/reconcile`,
                      version,
                      warning: 'Chỉ đối soát khi toàn bộ vật tư đã có kết quả bàn giao.',
                    })}
                </>
              )}
              {page === 'distribution' &&
                id &&
                status === 'DISPATCHED' &&
                detail.dispatch_actor_user_id !== user.id &&
                Array.isArray(detail.lines) &&
                rights.has('OPERATIONS_MANAGER') &&
                command({
                  title: 'Ghi nhận bàn giao thực tế',
                  service: 'logistics',
                  path: `/distributions/${id}/handoffs`,
                  fields: [
                    {
                      name: 'handoff_kind',
                      label: 'Loại bàn giao',
                      type: 'select',
                      required: true,
                      options: [
                        ['DIRECT_HOUSEHOLD', 'Giao trực tiếp cho hộ dân'],
                        ['RETURN', 'Hoàn về kho'],
                        ['LOSS', 'Ghi nhận thất thoát'],
                      ].map(([value, title]) => ({ value, label: title })),
                    },
                    {
                      name: 'distribution_line_id',
                      label: 'Dòng vật phẩm',
                      type: 'select',
                      required: true,
                      options: (detail.lines as Row[]).map((line) => ({
                        value: string(line.id),
                        label: `${string(line.item_name) || string(line.item_id)} · ${lineQuantity(line, line.quantity)}`,
                      })),
                    },
                    { name: 'quantity', label: 'Số lượng thực tế', type: 'number', required: true,
                      scaleFor: (values) => Number(((detail.lines as Row[]).find((line) => line.id === values.distribution_line_id)?.unit as Row)?.scale ?? 3),
                      maxFor: (values) => { const line = (detail.lines as Row[]).find((line) => line.id === values.distribution_line_id); return line ? Number(line.in_transit) : undefined; },
                    },
                    {
                      name: 'source_stage',
                      label: 'Nguồn vật tư',
                      type: 'select', required: true, visibleFor: (values) => ['RETURN', 'LOSS'].includes(values.handoff_kind),
                      options: [
                        ['IN_TRANSIT', 'Đang vận chuyển'],
                      ].map(([value, title]) => ({ value, label: title })),
                    },
                    {
                      name: 'receiver_label',
                      label: 'Người hoặc đơn vị nhận', visibleFor: (values) => values.handoff_kind !== 'LOSS',
                      requiredWhen: {
                        field: 'handoff_kind',
                        values: ['DIRECT_HOUSEHOLD', 'RETURN'],
                      },
                    },
                    { name: 'confirmation_basis', label: 'Căn cứ xác nhận', required: true },
                    {
                      name: 'occurred_at',
                      label: 'Thời điểm thực tế',
                      type: 'datetime-local',
                      required: true,
                      initialValue: new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
                        .toISOString().slice(0, 16),
                    },
                  ],
                  build: (values) => ({
                    handoff_kind: values.handoff_kind,
                    ...(['RETURN', 'LOSS'].includes(values.handoff_kind) && values.source_stage
                      ? { source_stage: values.source_stage }
                      : {}),
                    ...(values.handoff_kind !== 'LOSS' && values.receiver_label
                      ? { receiver_label: values.receiver_label }
                      : {}),
                    confirmation_basis: values.confirmation_basis,
                    occurred_at: new Date(values.occurred_at).toISOString(),
                    lines: [
                      {
                        distribution_line_id: values.distribution_line_id,
                        quantity: values.quantity,
                      },
                    ],
                  }),
                  warning:
                    'Chỉ xác nhận khi đã kiểm tra việc bàn giao thực tế. Bản ghi này ảnh hưởng số liệu đối soát.',
                })}
            </div>
            </div>
          </>
        )}
        </div>}
        {!selected &&
          page === 'drives' &&
          (rights.has('COORDINATOR') || rights.has('OPERATIONS_MANAGER')) &&
          <p className="notice">Đợt quyên góp được tạo và chỉnh sửa trên bản đồ tại <a href="?workspace=operations&page=assets">Kho và đợt quyên góp</a>, nơi chọn vị trí điểm quyên góp trong vùng phục vụ của kho.</p>}
        {!selected &&
          page === 'needs' &&
          (rights.has('OPERATIONS_MANAGER') || rights.has('COORDINATOR')) &&
          command(needCreate)}
        {!selected &&
          page === 'distribution' &&
          rights.has('OPERATIONS_MANAGER') &&
          command({
            title: 'Tạo phiếu phân phối',
            service: 'logistics',
            path: '/distributions',
            fields: [
              { ...referenceField('warehouse_id', 'Kho xuất hàng', 'warehouses', true), resetOnChange: ['commitment_id'] },
              { ...referenceField('item_id', 'Vật phẩm', 'items', true), resetOnChange: ['commitment_id'] },
              {
                name: 'purpose',
                label: 'Mục đích',
                type: 'select',
                required: true,
                options: [
                  ['REQUEST_AID', 'Hỗ trợ yêu cầu SOS'],
                  ['CAMPAIGN_DISTRIBUTION', 'Phân phối theo chiến dịch'],
                ].map(([value, title]) => ({ value, label: title })),
              },
              { name: 'quantity', label: 'Số lượng', type: 'number', required: true, scaleFor: (values) => { const chosen = commitments.find((item) => item.id === values.commitment_id); const scale = references.itemScales?.find(item => item.value === values.item_id); return chosen ? Number(chosen.unit_scale) : scale ? Number(scale.label) : undefined; }, maxFor: (values) => values.purpose === 'REQUEST_AID' && values.commitment_id ? (commitments.some((item) => item.id === values.commitment_id) ? Number(commitments.find((item) => item.id === values.commitment_id)!.reserved_remaining) : undefined) : undefined },
              { name: 'commitment_id', label: 'Cam kết hỗ trợ SOS', type: 'select', required: true,
                visibleWhen: { field: 'purpose', value: 'REQUEST_AID' },
                emptyLabel: commitmentsLoading ? 'Đang tải cam kết…' : 'Chọn cam kết của kho và vật phẩm',
                optionsFor: (values) => commitments.filter((item) => item.warehouse_id === values.warehouse_id && item.item_id === values.item_id)
                  .map((item) => ({ value: item.id!, label: string(item.item_name) + ' · còn ' + quantity(item.reserved_remaining) + ' ' + string(item.unit_name) + ' · ' + string(item.warehouse_name) + ' · SOS …' + string(item.request_id).slice(-8) })),
              },
              { ...referenceField('campaign_id', 'Chiến dịch', 'campaigns', true), visibleWhen: { field: 'purpose', value: 'CAMPAIGN_DISTRIBUTION' } },
            ],
            build: (values) => ({
              warehouse_id: values.warehouse_id,
              purpose: values.purpose,
              ...(values.purpose === 'CAMPAIGN_DISTRIBUTION' && values.campaign_id ? { campaign_id: values.campaign_id } : {}),
              lines: [
                {
                  item_id: values.item_id,
                  quantity: values.quantity,
                  ...(values.purpose === 'REQUEST_AID' && values.commitment_id ? { commitment_id: values.commitment_id } : {}),
                },
              ],
            }),
          })}
        {!selected && ['intake', 'review', 'handoff'].includes(page) && (
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
