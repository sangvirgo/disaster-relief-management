import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { roles, type Me } from '../../auth/session';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { label, timeLabel } from '../../i18n/labels';
import { ReceiptCountForm } from './ReceiptCountForm';
import { RecoveryIssue } from '../../components/RecoveryIssue';
import { DetailCloseButton } from '../../components/DetailCloseButton';

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
const routes: Record<string, string> = {
  overview: '/reports/stock-summary',
  drives: '/donation-drives',
  intake: '/donation-deliveries',
  review: '/donation-deliveries',
  stock: '/stock',
  assets: '/relief-points',
  needs: '/needs',
  distribution: '/distributions',
  handoff: '/distributions',
  reports: '/reports/stock-summary',
};
const headings: Record<string, string> = {
  overview: 'Tình hình vật tư',
  drives: 'Đợt quyên góp',
  intake: 'Tiếp nhận đóng góp',
  review: 'Duyệt biên nhận',
  stock: 'Tồn kho',
  assets: 'Điểm và phương tiện',
  needs: 'Nhu cầu cứu trợ',
  distribution: 'Phân phối vật tư',
  handoff: 'Bàn giao vật tư',
  reports: 'Báo cáo và đối soát',
};
const string = (value: unknown) => (typeof value === 'string' ? value : '');
const number = (value: unknown) => (typeof value === 'number' ? value : undefined);
const quantity = (value: unknown) => (value == null ? '—' : String(value));
const distributionPages = new Set(['distribution', 'handoff']);
function recordTitle(page: string, item: Row): string {
  if (distributionPages.has(page)) return string(item.purpose) ? label(item.purpose) : 'Phiếu phân phối';
  if (page === 'intake') return string(item.donor_name) ? `Đóng góp của ${item.donor_name}` : 'Đóng góp chờ tiếp nhận';
  return item.title || item.name || item.public_code || string(item.identifier) || string(item.item_name) ||
    string((item.item as Row | undefined)?.name) || item.id || 'Bản ghi';
}
function distributionItems(item: Row): string {
  const lines = Array.isArray(item.lines) ? item.lines as Row[] : [];
  if (!lines.length) return 'Chưa có vật phẩm';
  const first = lines[0];
  const name = string(first.item_name) || 'Vật phẩm';
  return `${name} · ${quantity(first.quantity)}${lines.length > 1 ? ` · +${lines.length - 1} vật phẩm` : ''}`;
}
const fields = (entries: [string, string, boolean?][]) =>
  entries.map(([name, title, required]) => ({ name, label: title, required }));

export function Operations({ page, user }: { page: string; user: Me }) {
  const rights = roles(user);
  const [asset, setAsset] = useState<'relief-points' | 'vehicles' | 'warehouses'>('relief-points');
  const [reviewTab, setReviewTab] = useState<'receipts' | 'disputes'>('receipts');
  const [report, setReport] = useState<'stock-summary' | 'fulfillment' | 'reconciliation'>(
    'stock-summary'
  );
  const [warehouse, setWarehouse] = useState('');
  const [region, setRegion] = useState('');
  const [items, setItems] = useState<Row[]>([]);
  const [cursor, setCursor] = useState('');
  const [next, setNext] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState('');
  const [selected, setSelected] = useState<Row | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
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
  if (cursor) params.set('cursor', cursor);
  if (page === 'reports' && report === 'reconciliation' && warehouse)
    params.set('warehouse_id', warehouse);
  if (page === 'reports' && report === 'fulfillment' && region) {
    params.set('region_code', region);
    params.set('from', new Date(Date.now() - 30 * 86_400_000).toISOString());
    params.set('to', new Date().toISOString());
  }
  const path = route + (params.size ? `?${params}` : '');
  const ready = !(
    page === 'reports' &&
    ((report === 'reconciliation' && !warehouse) || (report === 'fulfillment' && !region))
  );
  useEffect(() => {
    if (!route || !ready) {
      setItems([]);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setError('');
    setItems([]);
    api<List>('logistics', path)
      .then((value) => {
        if (live) {
          setItems(value.items || []);
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
    if (!selected?.id) {
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
        : page === 'distribution' || page === 'handoff'
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
  }, [selected, revision, page, reviewTab]);
  function done() {
    setSelected(null);
    setDetail(null);
    setRevision((value) => value + 1);
  }
  function command(spec: CommandSpec) {
    return (
      <CommandForm key={spec.path + String(spec.version ?? '')} spec={spec} onSuccess={done} />
    );
  }
  const id = detail?.id;
  const version = number(detail?.version);
  const status = string(detail?.delivery_status || detail?.status);
  const receiptId =
    page === 'intake' || (page === 'review' && reviewTab === 'receipts')
      ? string(selected?.receipt_id)
      : '';
  const count = detail?.count as Row | null | undefined;
  const driveCreate: CommandSpec = {
    title: 'Tạo đợt quyên góp',
    service: 'logistics',
    path: '/donation-drives',
    fields: [
      ...fields([
        ['title', 'Tên đợt quyên góp', true],
        ['description', 'Mô tả', true],
        ['intake_warehouse_id', 'Mã kho tiếp nhận', true],
        ['campaign_id', 'Mã chiến dịch nếu có'],
        ['item_id', 'Mã vật phẩm', true],
      ]),
      { name: 'target_quantity', label: 'Số lượng mục tiêu', type: 'number', required: true },
    ],
    build: (values) => ({
      title: values.title,
      description: values.description,
      intake_warehouse_id: values.intake_warehouse_id,
      ...(values.campaign_id ? { campaign_id: values.campaign_id } : {}),
      items: [{ item_id: values.item_id, target_quantity: values.target_quantity }],
    }),
  };
  const needCreate: CommandSpec = {
    title: 'Ghi nhận nhu cầu',
    service: 'logistics',
    path: '/needs',
    fields: [
      ...fields([
        ['request_id', 'Mã yêu cầu SOS', true],
        ['item_id', 'Mã vật phẩm', true],
      ]),
      { name: 'work_cycle', label: 'Chu kỳ xử lý', type: 'number', required: true },
      { name: 'quantity', label: 'Số lượng cần', type: 'number', required: true },
    ],
    build: (values) => ({
      request_id: values.request_id,
      work_cycle: Number(values.work_cycle),
      item_id: values.item_id,
      quantity: values.quantity,
    }),
  };
  return (
    <div className={`coordinator-layout ${page === 'stock' || (page === 'reports' && report === 'stock-summary') ? 'operations-table-layout' : ''}`}>
      <section className="card">
        <h2>{headings[page]}</h2>
        {page === 'assets' && (
          <div className="tabs">
            {(
              [
                ['relief-points', 'Điểm cứu trợ'],
                ['vehicles', 'Phương tiện'],
                ['warehouses', 'Kho'],
              ] as const
            ).map(([value, title]) => (
              <button
                key={value}
                className={asset === value ? 'active' : ''}
                onClick={() => {
                  setAsset(value);
                  setCursor('');
                  setSelected(null);
                }}
              >
                {title}
              </button>
            ))}
          </div>
        )}
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
        {page === 'reports' && (
          <>
            <div className="tabs">
              {(
                [
                  ['stock-summary', 'Tổng hợp kho'],
                  ['fulfillment', 'Đáp ứng nhu cầu'],
                  ['reconciliation', 'Đối soát'],
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
                Mã kho cần đối soát
                <input
                  value={warehouse}
                  onChange={(event) => {
                    setWarehouse(event.target.value);
                    setCursor('');
                  }}
                />
              </label>
            )}
            {report === 'fulfillment' && (
              <label className="filter">
                Mã khu vực trong 30 ngày gần đây
                <input
                  value={region}
                  onChange={(event) => {
                    setRegion(event.target.value);
                    setCursor('');
                  }}
                />
              </label>
            )}
          </>
        )}
        {!ready && <p>Nhập bộ lọc bắt buộc để tải báo cáo theo phạm vi được cấp quyền.</p>}
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
        {(page === 'stock' || (page === 'reports' && report === 'stock-summary')) ? (
          <><p className="table-swipe-hint">Vuốt ngang bảng để xem các cột số lượng.</p><div className="stock-table-scroll">
            <table className="stock-table">
              <thead><tr><th>Vật phẩm</th><th>Kho</th><th>Đơn vị</th><th className="numeric">Tồn thực tế</th><th className="numeric">Đã giữ</th><th className="numeric">Khả dụng</th></tr></thead>
              <tbody>{items.map((item, index) => (
                <tr key={string(item.id || item.balance_id) || index} className={selected === item ? 'selected' : ''}>
                  <th scope="row"><button type="button" className="table-row-link" onClick={() => setSelected(item)}>{string((item.item as Row | undefined)?.name) || string(item.item_name) || item.name || 'Vật phẩm'}</button></th>
                  <td>{string(item.warehouse_name) || (item.warehouse_id ? `Mã …${string(item.warehouse_id).slice(-8)}` : '—')}</td>
                  <td>{string((item.unit as Row | undefined)?.display_name) || string(item.unit) || string(item.unit_name) || '—'}</td>
                  <td className="numeric">{quantity(item.on_hand)}</td>
                  <td className="numeric">{quantity(item.reserved)}</td>
                  <td className="numeric"><strong className="available-value">{quantity(item.available)}</strong></td>
                </tr>
              ))}</tbody>
            </table>
          </div></>
        ) : <div className="record-list">
          {items.map((item, index) => (
            <button
              type="button"
              className={`queue-row ${selected === item ? 'selected' : ''}`}
              key={item.id || index}
              onClick={() => setSelected(item)}
            >
              <span>
                <strong>
                  {recordTitle(page, item)}
                </strong>
                {distributionPages.has(page) && <small>Phiếu phân phối · {distributionItems(item)}</small>}
                {page === 'intake' && <small>{string(item.drive_title) || 'Đợt quyên góp'}{item.public_code ? ` · Mã ${item.public_code}` : ''}</small>}
                <small>
                  {page !== 'intake' && item.donor_name ? `Người đóng góp: ${item.donor_name} · ` : ''}
                  {item.created_at
                    ? timeLabel(item.created_at)
                    : string(item.warehouse_name) || string(item.region_code)}
                </small>
                {item.on_hand != null && (
                  <small>
                    Tồn: {quantity(item.on_hand)} · Khả dụng: {quantity(item.available)} · Đã giữ:{' '}
                    {quantity(item.reserved)}
                  </small>
                )}
                {item.requested != null && (
                  <small>
                    Cần: {quantity(item.requested)} · Đã giao: {quantity(item.delivered)} · Còn
                    thiếu: {quantity(item.outstanding)}
                  </small>
                )}
                {item.active_requested != null && (
                  <small>
                    Nhu cầu hiện hành: {quantity(item.active_requested)} · Đã giao:{' '}
                    {quantity(item.delivered)} · Còn thiếu: {quantity(item.active_outstanding)}
                  </small>
                )}
                {item.posted_movements != null && (
                  <small>
                    Nhập đã ghi sổ: {quantity(item.intake_accepted)} · Đang vận chuyển:{' '}
                    {quantity(item.issued_in_transit)} · Tại điểm: {quantity(item.at_point)}
                  </small>
                )}
                {item.receipt_id && <small>Đã lập biên nhận</small>}
              </span>
              {item.status && <span className="chip">{label(item.status)}</span>}
            </button>
          ))}
        </div>}
        {next && (
          <button className="button secondary" onClick={() => setCursor(next)}>
            Xem thêm
          </button>
        )}
      </section>
      <section className={`card detail-panel-card ${selected ? 'is-open' : ''}`}>
        {selected && <DetailCloseButton onClick={() => { setSelected(null); setDetail(null); }} />}
        <h2>
          {selected
            ? 'Chi tiết và thao tác'
            : ['drives', 'needs', 'assets', 'distribution'].includes(page)
              ? 'Tạo bản ghi'
              : 'Thông tin theo phạm vi'}
        </h2>
        {selected && !detail && <p role="status">Đang tải chi tiết…</p>}
        {detail && (
          <>
            <div className="detail-grid">
              {page === 'assets' && asset === 'vehicles' && Boolean(detail.identifier) && (
                <p><strong>Biển số hoặc mã xe</strong><br />{string(detail.identifier)}</p>
              )}
              {distributionPages.has(page) && Boolean(detail.purpose) && (
                <p><strong>Mục đích phân phối</strong><br />{label(detail.purpose)}</p>
              )}
              <p>
                <strong>{distributionPages.has(page) ? 'Mã phiếu phân phối' : page === 'intake' ? 'Mã tiếp nhận' : 'Mã bản ghi'}</strong>
                <br />
                {string(selected?.id || selected?.balance_id || selected?.warehouse_id) ||
                  'Không có mã riêng'}
              </p>
              {status && (
                <p>
                  <strong>Trạng thái</strong>
                  <br />
                  {label(status)}
                </p>
              )}
              {version != null && (
                <p>
                  <strong>Phiên bản</strong>
                  <br />
                  {version}
                </p>
              )}
              {Boolean(detail.intake_warehouse_id) && (
                <p>
                  <strong>Kho tiếp nhận</strong>
                  <br />
                  {string(detail.intake_warehouse_id)}
                </p>
              )}
              {Boolean(detail.warehouse_id) && (
                <p>
                  <strong>Kho</strong>
                  <br />
                  {string(detail.warehouse_id)}
                </p>
              )}
              {Boolean(detail.public_code) && (
                <p>
                  <strong>Mã công khai</strong>
                  <br />
                  {string(detail.public_code)}
                </p>
              )}
              {detail.on_hand != null && (
                <p>
                  <strong>Tồn khả dụng</strong>
                  <br />
                  {quantity(detail.available)} / {quantity(detail.on_hand)}
                </p>
              )}
              {detail.held != null && (
                <p>
                  <strong>Tạm giữ</strong>
                  <br />
                  {quantity(detail.held)}
                </p>
              )}
              {detail.in_transit != null && (
                <p>
                  <strong>Đang vận chuyển</strong>
                  <br />
                  {quantity(detail.in_transit)}
                </p>
              )}
              {detail.delivered != null && (
                <p>
                  <strong>Đã giao</strong>
                  <br />
                  {quantity(detail.delivered)}
                </p>
              )}
            </div>
            {Array.isArray(detail.lines) && (
              <div>
                <h3>Vật phẩm và số lượng</h3>
                {(detail.lines as Row[]).map((line, index) => (
                  <div className="candidate" key={string(line.id) || index}>
                    <strong>{string(line.item_name) || string(line.item_id) || 'Vật phẩm'}</strong>
                    <p>
                      Số lượng: {quantity(line.quantity)} · Đã giao: {quantity(line.handed_out)} ·
                      Đang vận chuyển: {quantity(line.in_transit)} · Tại điểm:{' '}
                      {quantity(line.at_point)}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {count && (
              <div className="candidate">
                <h3>Kết quả kiểm đếm lần {quantity(count.revision)}</h3>
                {Array.isArray(count.lines) &&
                  (count.lines as Row[]).map((line, index) => (
                    <p key={index}>
                      {string(line.item_name) || string(line.item_id)}: khai{' '}
                      {quantity(line.declared_quantity)}, đếm {quantity(line.counted_quantity)},
                      nhận {quantity(line.accepted_quantity)}, giữ {quantity(line.held_quantity)},
                      từ chối {quantity(line.rejected_quantity)}
                    </p>
                  ))}
              </div>
            )}
            <div className="action-grid">
              {page === 'assets' &&
                id &&
                version != null &&
                status === 'ACTIVE' &&
                rights.has('OPERATIONS_MANAGER') &&
                command({
                  title: 'Ngừng sử dụng',
                  service: 'logistics',
                  path: `/${asset}/${id}/deactivate`,
                  version,
                  warning:
                    'Ngừng sử dụng tài sản hoặc địa điểm này? Các phiếu đang liên quan có thể cần xử lý trước.',
                })}
              {page === 'drives' &&
                id &&
                version != null &&
                (rights.has('CAMPAIGN_MANAGER') || rights.has('OPERATIONS_MANAGER')) &&
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
              {page === 'intake' &&
                selected?.id &&
                !selected.receipt_id &&
                rights.has('INTAKE_STAFF') &&
                command({
                  title: 'Lập biên nhận',
                  service: 'logistics',
                  path: '/donation-receipts',
                  fields: fields([['warehouse_id', 'Mã kho tiếp nhận', true]]),
                  build: (values) => ({
                    delivery_id: selected.id,
                    warehouse_id: values.warehouse_id,
                  }),
                })}
              {page === 'intake' &&
                selected?.id &&
                selected.version != null &&
                rights.has('INTAKE_STAFF') && (
                  <RecoveryIssue
                    key={`recovery-${selected.id}-${selected.version}`}
                    service="logistics"
                    path={`/donation-deliveries/${selected.id}/recovery`}
                    version={selected.version}
                    kind="donation"
                  />
                )}
              {page === 'intake' &&
                receiptId &&
                version != null &&
                rights.has('INTAKE_STAFF') &&
                status !== 'POSTED' && (
                  <ReceiptCountForm
                    key={receiptId + version}
                    receiptId={receiptId}
                    version={version}
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
              {page === 'review' &&
                receiptId &&
                count &&
                version != null &&
                rights.has('REVIEWER') && (
                  <>
                    {command({
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
                        { name: 'reason', label: 'Lý do', type: 'textarea', required: true },
                      ],
                      build: (values) => ({
                        count_revision: count.revision,
                        declaration_revision: count.declaration_revision,
                        decision: values.decision,
                        reason: values.reason,
                      }),
                      warning: 'Xác nhận quyết định duyệt độc lập cho phiên bản hiện tại?',
                    })}
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
                      title: 'Điều chỉnh số lượng cần',
                      service: 'logistics',
                      path: `/needs/${id}/increase`,
                      version,
                      fields: [
                        {
                          name: 'quantity',
                          label: 'Tổng số lượng mới',
                          type: 'number',
                          required: true,
                        },
                        { name: 'reason', label: 'Lý do', type: 'textarea', required: true },
                      ],
                      build: (values) => ({ quantity: values.quantity, reason: values.reason }),
                    })}
                    {command({
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
                        },
                        { name: 'reason', label: 'Lý do', type: 'textarea', required: true },
                      ],
                      build: (values) => ({ quantity: values.quantity, reason: values.reason }),
                      warning: 'Xác nhận giảm nhu cầu theo số lượng còn đủ điều kiện?',
                    })}
                    {command({
                      title: 'Hủy phần nhu cầu còn lại',
                      service: 'logistics',
                      path: `/needs/${id}/cancel`,
                      version,
                      fields: [
                        { name: 'reason', label: 'Lý do hủy', type: 'textarea', required: true },
                      ],
                      warning: 'Xác nhận hủy phần nhu cầu chưa được giao?',
                    })}
                    {rights.has('OPERATIONS_MANAGER') &&
                      command({
                        title: 'Cam kết xuất kho',
                        service: 'logistics',
                        path: `/needs/${id}/commitments`,
                        fields: [
                          ...fields([['warehouse_id', 'Mã kho', true]]),
                          { name: 'quantity', label: 'Số lượng', type: 'number', required: true },
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
                    (rights.has('DISTRIBUTION_STAFF') || rights.has('INTAKE_STAFF')) &&
                    command({
                      title: 'Xuất kho',
                      service: 'logistics',
                      path: `/distributions/${id}/dispatch`,
                      version,
                      warning: 'Kiểm tra hàng thực tế và xác nhận xuất kho?',
                    })}
                  {status === 'DRAFT' &&
                    (rights.has('DISTRIBUTION_STAFF') ||
                      rights.has('INTAKE_STAFF') ||
                      rights.has('OPERATIONS_MANAGER')) &&
                    command({
                      title: 'Chuẩn bị từ cam kết',
                      service: 'logistics',
                      path: `/distributions/${id}/prepare-from-commitments`,
                      version,
                      warning: 'Thay thế các dòng phiếu bằng cam kết hiện có?',
                    })}
                  {['DRAFT', 'APPROVED'].includes(status) &&
                    (detail.preparer_user_id === user.id || detail.approver_user_id === user.id) &&
                    command({
                      title: 'Hủy phiếu',
                      service: 'logistics',
                      path: `/distributions/${id}/cancel`,
                      version,
                      warning: 'Xác nhận hủy phiếu phân phối trước khi xuất kho?',
                    })}
                  {status === 'DISPATCHED' &&
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
              {page === 'handoff' &&
                id &&
                status === 'DISPATCHED' &&
                detail.dispatch_actor_user_id !== user.id &&
                Array.isArray(detail.lines) &&
                (rights.has('DISTRIBUTION_STAFF') || rights.has('INTAKE_STAFF')) &&
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
                      options: (rights.has('DISTRIBUTION_STAFF')
                        ? detail.relief_point_id
                          ? [
                              ['POINT_RECEIPT', 'Điểm cứu trợ đã nhận'],
                              ['HOUSEHOLD_HANDOUT', 'Đã giao cho hộ dân'],
                              ['RETURN', 'Hoàn về kho'],
                              ['LOSS', 'Ghi nhận thất thoát'],
                            ]
                          : [
                              ['DIRECT_HOUSEHOLD', 'Giao trực tiếp cho hộ dân'],
                              ['RETURN', 'Hoàn về kho'],
                              ['LOSS', 'Ghi nhận thất thoát'],
                            ]
                        : [['RETURN', 'Hoàn về kho']]
                      ).map(([value, title]) => ({ value, label: title })),
                    },
                    {
                      name: 'distribution_line_id',
                      label: 'Dòng vật phẩm',
                      type: 'select',
                      required: true,
                      options: (detail.lines as Row[]).map((line) => ({
                        value: string(line.id),
                        label: `${string(line.item_name) || string(line.item_id)} · ${quantity(line.quantity)}`,
                      })),
                    },
                    { name: 'quantity', label: 'Số lượng thực tế', type: 'number', required: true },
                    {
                      name: 'source_stage',
                      label: 'Nguồn vật tư (khi hoàn hoặc thất thoát)',
                      type: 'select',
                      options: [
                        ['IN_TRANSIT', 'Đang vận chuyển'],
                        ['AT_POINT', 'Tại điểm cứu trợ'],
                      ].map(([value, title]) => ({ value, label: title })),
                    },
                    {
                      name: 'receiver_label',
                      label: 'Người hoặc đơn vị nhận (không nhập khi thất thoát)',
                    },
                    { name: 'confirmation_basis', label: 'Căn cứ xác nhận', required: true },
                    {
                      name: 'occurred_at',
                      label: 'Thời điểm thực tế',
                      type: 'datetime-local',
                      required: true,
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
          </>
        )}
        {!selected &&
          page === 'drives' &&
          (rights.has('CAMPAIGN_MANAGER') || rights.has('OPERATIONS_MANAGER')) &&
          command(driveCreate)}
        {!selected && page === 'needs' && (rights.has('OPERATIONS_MANAGER') || rights.has('COORDINATOR')) && command(needCreate)}
        {!selected &&
          page === 'assets' &&
          rights.has('OPERATIONS_MANAGER') &&
          command({
            title:
              asset === 'vehicles'
                ? 'Thêm phương tiện'
                : asset === 'warehouses'
                  ? 'Thêm kho'
                  : 'Thêm điểm cứu trợ',
            service: 'logistics',
            path: `/${asset}`,
            fields:
              asset === 'vehicles'
                ? fields([
                    ['organization_id', 'Mã tổ chức', true],
                    ['region_code', 'Mã khu vực', true],
                    ['identifier', 'Biển số hoặc mã xe', true],
                    ['vehicle_type', 'Loại phương tiện', true],
                  ])
                : asset === 'warehouses'
                  ? fields([
                      ['organization_id', 'Mã tổ chức', true],
                      ['region_code', 'Mã khu vực', true],
                      ['name', 'Tên kho', true],
                    ])
                  : fields([
                      ['organization_id', 'Mã tổ chức', true],
                      ['region_code', 'Mã khu vực', true],
                      ['name', 'Tên điểm', true],
                      ['longitude', 'Kinh độ', true],
                      ['latitude', 'Vĩ độ', true],
                    ]),
            build:
              asset === 'relief-points'
                ? (values) => ({
                    organization_id: values.organization_id,
                    region_code: values.region_code,
                    name: values.name,
                    location: {
                      type: 'Point',
                      coordinates: [Number(values.longitude), Number(values.latitude)],
                    },
                  })
                : undefined,
          })}
        {!selected &&
          page === 'distribution' &&
          (rights.has('DISTRIBUTION_STAFF') ||
            rights.has('INTAKE_STAFF') ||
            rights.has('OPERATIONS_MANAGER')) &&
          command({
            title: 'Tạo phiếu phân phối',
            service: 'logistics',
            path: '/distributions',
            fields: [
              ...fields([
                ['warehouse_id', 'Mã kho', true],
                ['item_id', 'Mã vật phẩm', true],
              ]),
              {
                name: 'purpose',
                label: 'Mục đích',
                type: 'select',
                required: true,
                options: [
                  ['REQUEST_AID', 'Hỗ trợ yêu cầu SOS'],
                  ['CAMPAIGN_DISTRIBUTION', 'Phân phối theo chiến dịch'],
                  ['POINT_REPLENISHMENT', 'Bổ sung tại điểm cứu trợ'],
                ].map(([value, title]) => ({ value, label: title })),
              },
              { name: 'quantity', label: 'Số lượng', type: 'number', required: true },
              ...fields([
                ['commitment_id', 'Mã cam kết khi hỗ trợ yêu cầu SOS'],
                ['campaign_id', 'Mã chiến dịch khi phân phối theo chiến dịch'],
                ['relief_point_id', 'Mã điểm cứu trợ khi bổ sung tại điểm'],
                ['vehicle_id', 'Mã phương tiện nếu có'],
              ]),
            ],
            build: (values) => ({
              warehouse_id: values.warehouse_id,
              purpose: values.purpose,
              ...(values.campaign_id ? { campaign_id: values.campaign_id } : {}),
              ...(values.relief_point_id ? { relief_point_id: values.relief_point_id } : {}),
              ...(values.vehicle_id ? { vehicle_id: values.vehicle_id } : {}),
              lines: [
                {
                  item_id: values.item_id,
                  quantity: values.quantity,
                  ...(values.commitment_id ? { commitment_id: values.commitment_id } : {}),
                },
              ],
            }),
          })}
        {!selected && ['intake', 'review', 'handoff'].includes(page) && (
          <p>Chọn bản ghi trong danh sách để xem trạng thái và thao tác thuộc quyền của bạn.</p>
        )}
        {!selected && ['overview', 'stock', 'reports'].includes(page) && (
          <p>
            Chọn một dòng để xem số liệu trả về trong phạm vi kho hoặc khu vực được cấp quyền. Số
            lượng được giữ theo từng đơn vị vật phẩm.
          </p>
        )}
      </section>
    </div>
  );
}
