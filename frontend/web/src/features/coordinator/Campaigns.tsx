import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useCursorNav, LIST_PAGE_SIZE } from '../../api/useCursorNav';
import { ListNav } from '../../components/ui/Pager';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { DetailCloseButton } from '../../components/DetailCloseButton';
import { StatusBadge } from '../../components/StatusBadge';
import { SuccessBanner } from '../../components/SuccessBanner';
import { label, timeLabel } from '../../i18n/labels';

type Campaign = {
  id: string;
  name: string;
  objective: string | null;
  status: string;
  version: number;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
};
export function Campaigns() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [cursor, setCursor, prevPage, pageIndex] = useCursorNav<string>('');
  const [next, setNext] = useState('');
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [error, setError] = useState('');
  const [conflictNotice, setConflictNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [createdName, setCreatedName] = useState('');
  useEffect(() => {
    if (!createdName) return;
    const timer = window.setTimeout(() => setCreatedName(''), 8000);
    return () => window.clearTimeout(timer);
  }, [createdName]);
  useEffect(() => {
    let live = true;
    setError('');
    setLoading(true);
    api<{ items: Campaign[]; more: boolean; cursor?: string }>(
      'response',
      `/campaigns?limit=${LIST_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    )
      .then((value) => {
        if (live) {
          setItems(value.items);
          setSelected(current => current ? value.items.find(item => item.id === current.id) || (cursor ? current : null) : null);
          setNext(value.more ? value.cursor || '' : '');
        }
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải chiến dịch.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [cursor, revision]);
  function done() {
    setCursor('');
    setRevision((value) => value + 1);
  }
  function changeStatusFilter(value: string) {
    setStatusFilter(value);
    setSelected(current => current && value !== 'ALL' && current.status !== value ? null : current);
  }
  const create: CommandSpec = {
    title: 'Tạo chiến dịch',
    service: 'response',
    path: '/campaigns',
    fields: [
      { name: 'name', label: 'Tên chiến dịch', required: true },
      { name: 'objective', label: 'Mục tiêu (nếu có)', type: 'textarea' },
      { name: 'starts_at', label: 'Thời điểm bắt đầu (nếu có)', type: 'datetime-local' },
      { name: 'ends_at', label: 'Thời điểm kết thúc (nếu có)', type: 'datetime-local' },
    ],
    build: (values) => {
      if (values.starts_at && values.ends_at && new Date(values.ends_at) <= new Date(values.starts_at))
        throw new Error('Thời điểm kết thúc phải sau thời điểm bắt đầu.');
      return {
        name: values.name.trim().normalize('NFC'),
        ...(values.objective?.trim() ? { objective: values.objective.trim() } : {}),
        ...(values.starts_at ? { starts_at: new Date(values.starts_at).toISOString() } : {}),
        ...(values.ends_at ? { ends_at: new Date(values.ends_at).toISOString() } : {}),
      };
    },
  };
  const id = selected?.id;
  const version = selected?.version;
  const visibleItems =
    statusFilter === 'ALL' ? items : items.filter((item) => item.status === statusFilter);
  const statusOptions = [...new Set(items.map((item) => item.status))];
  const action = (title: string, suffix: string, reason = false) =>
    id &&
    version && (
      <CommandForm
        key={id + suffix + version}
        spec={{
          title,
          service: 'response',
          path: `/campaigns/${id}/${suffix}`,
          version,
          warning: `Xác nhận ${title.toLocaleLowerCase('vi-VN')}?`,
          fields: reason
            ? [{ name: 'reason', label: 'Lý do', type: 'textarea', required: true }]
            : [],
        }}
        onSuccess={() => { setConflictNotice(''); done(); }}
        onStale={() => {
          setConflictNotice('Dữ liệu đã thay đổi ở phiên làm việc khác. Hãy kiểm tra trạng thái mới trước khi thao tác tiếp.');
          done();
        }}
      />
    );
  return (
    <div className="campaign-layout">
      <section className="card campaign-list-panel">
        {createdName && <div className="campaign-success-toast"><SuccessBanner title="Đã tạo chiến dịch thành công" description={`Chiến dịch “${createdName}” đã được lưu. Bạn có thể chọn trong danh sách để kích hoạt.`} /></div>}
        <div className="section-header">
          <div>
            <span className="eyebrow">Điều phối cứu trợ</span>
            <h2>Danh sách chiến dịch</h2>
          </div>
          <span className="chip">Đã tải {items.length} chiến dịch</span>
        </div>
        <p>Chọn chiến dịch để xem mục tiêu, thời gian và thao tác được cấp quyền.</p>
        <button type="button" className="button secondary" disabled={loading} onClick={done}>Cập nhật</button>
        {conflictNotice && <p className="notice warning" role="status">{conflictNotice}</p>}
        <div className="campaign-filters" role="group" aria-label="Lọc chiến dịch theo trạng thái">
          <button
            type="button"
            className={statusFilter === 'ALL' ? 'active' : ''}
            aria-pressed={statusFilter === 'ALL'}
            onClick={() => changeStatusFilter('ALL')}
          >
            Tất cả
          </button>
          {statusOptions.map((status) => (
            <button
              type="button"
              key={status}
              className={statusFilter === status ? 'active' : ''}
              aria-pressed={statusFilter === status}
              onClick={() => changeStatusFilter(status)}
            >
              {label(status)}
            </button>
          ))}
        </div>
        {loading && <p role="status">Đang tải chiến dịch…</p>}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && !items.length && (
          <div className="empty">Chưa có chiến dịch trong phạm vi được cấp quyền.</div>
        )}
        <div className="campaign-list">
          {visibleItems.map((item) => (
            <button
              className={`campaign-card ${selected?.id === item.id ? 'selected' : ''}`}
              onClick={() => { setConflictNotice(''); setSelected(item); }}
              key={item.id}
            >
              <span className="campaign-card-main">
                <strong>{item.name}</strong>
                <small>{item.objective || 'Chưa có mô tả mục tiêu.'}</small>
                <span>
                  Tạo {timeLabel(item.created_at)}
                </span>
              </span>
              <StatusBadge status={item.status} />
            </button>
          ))}
        </div>
        {!loading && items.length > 0 && visibleItems.length === 0 && (
          <div className="empty">Không có chiến dịch ở trạng thái này trên trang hiện tại.</div>
        )}
        <ListNav page={pageIndex} hasNext={Boolean(next)} loading={loading} onPrev={prevPage} onNext={() => next && setCursor(next)} count={items.length} noun="chiến dịch" />
      </section>
      <section
        className={`card campaign-detail-panel detail-panel-card ${selected ? 'is-open' : ''}`}
      >
        {selected && <DetailCloseButton onClick={() => setSelected(null)} />}
        <span className="eyebrow">{selected ? 'Hồ sơ chiến dịch' : 'Chiến dịch mới'}</span>
        <h2>{selected ? selected.name : 'Thiết lập chiến dịch mới'}</h2>
        {selected ? (
          <>
            <p className="campaign-objective">{selected.objective || 'Chưa có mô tả mục tiêu.'}</p>
            <dl className="fact-list">
              <div>
                <dt>Trạng thái</dt>
                <dd>
                  <StatusBadge status={selected.status} />
                </dd>
              </div>
              <div>
                <dt>Bắt đầu</dt>
                <dd>{selected.starts_at ? timeLabel(selected.starts_at) : 'Chưa ấn định'}</dd>
              </div>
              <div>
                <dt>Kết thúc</dt>
                <dd>{selected.ends_at ? timeLabel(selected.ends_at) : 'Chưa ấn định'}</dd>
              </div>
            </dl>
            <div className="action-grid">
              {selected.status === 'DRAFT' && action('Kích hoạt chiến dịch', 'activate')}
              {selected.status === 'ACTIVE' && (
                <>
                  {action('Tạm dừng chiến dịch', 'pause', true)}
                  {action('Kết thúc chiến dịch', 'close', true)}
                </>
              )}
              {selected.status === 'PAUSED' && (
                <>
                  {action('Tiếp tục chiến dịch', 'resume')}
                  {action('Kết thúc chiến dịch', 'close', true)}
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <CommandForm key={revision} spec={create} onSuccess={(result) => { setCreatedName((result as Campaign | undefined)?.name || 'mới'); done(); }} />
          </>
        )}
      </section>
    </div>
  );
}
