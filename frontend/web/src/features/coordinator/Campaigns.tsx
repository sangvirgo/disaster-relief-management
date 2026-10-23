import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { DetailCloseButton } from '../../components/DetailCloseButton';
import { label, timeLabel } from '../../i18n/labels';

type Campaign = {
  id: string;
  name: string;
  objective: string | null;
  region_code: string | null;
  status: string;
  version: number;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
};
export function Campaigns() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [cursor, setCursor] = useState('');
  const [next, setNext] = useState('');
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [statusFilter, setStatusFilter] = useState('ALL');
  useEffect(() => {
    let live = true;
    setError('');
    setLoading(true);
    api<{ items: Campaign[]; more: boolean; cursor?: string }>(
      'response',
      `/campaigns${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`
    )
      .then((value) => {
        if (live) {
          setItems(value.items);
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
    setSelected(null);
    setRevision((value) => value + 1);
  }
  const create: CommandSpec = {
    title: 'Tạo chiến dịch',
    service: 'response',
    path: '/campaigns',
    fields: [
      { name: 'name', label: 'Tên chiến dịch', required: true },
      { name: 'objective', label: 'Mục tiêu', type: 'textarea' },
      { name: 'region_code', label: 'Mã khu vực nếu có', placeholder: 'Ví dụ: DEMO_A' },
      { name: 'starts_at', label: 'Thời điểm bắt đầu', type: 'datetime-local' },
      { name: 'ends_at', label: 'Thời điểm kết thúc', type: 'datetime-local' },
    ],
    build: (values) => ({
      name: values.name,
      ...(values.objective ? { objective: values.objective } : {}),
      ...(values.region_code ? { region_code: values.region_code } : {}),
      ...(values.starts_at ? { starts_at: new Date(values.starts_at).toISOString() } : {}),
      ...(values.ends_at ? { ends_at: new Date(values.ends_at).toISOString() } : {}),
    }),
  };
  const id = selected?.id;
  const version = selected?.version;
  const visibleItems = statusFilter === 'ALL' ? items : items.filter((item) => item.status === statusFilter);
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
        onSuccess={done}
      />
    );
  return (
    <div className="campaign-layout">
      <section className="card campaign-list-panel">
        <div className="section-header"><div><span className="eyebrow">Điều phối cứu trợ</span><h2>Chiến dịch cứu trợ</h2></div><span className="chip">{items.length} chiến dịch trên trang</span></div>
        <p>Chọn chiến dịch để xem mục tiêu, thời gian và thao tác được cấp quyền.</p>
        <div className="campaign-filters" role="group" aria-label="Lọc chiến dịch theo trạng thái">
          <button type="button" className={statusFilter === 'ALL' ? 'active' : ''} onClick={() => setStatusFilter('ALL')}>Tất cả</button>
          {statusOptions.map((status) => <button type="button" key={status} className={statusFilter === status ? 'active' : ''} onClick={() => setStatusFilter(status)}>{label(status)}</button>)}
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
              onClick={() => setSelected(item)}
              key={item.id}
            >
              <span className="campaign-card-main"><strong>{item.name}</strong><small>{item.objective || 'Chưa có mô tả mục tiêu.'}</small><span>{item.region_code || 'Nhiều khu vực'} · Tạo {timeLabel(item.created_at)}</span></span>
              <span className="chip">{label(item.status)}</span>
            </button>
          ))}
        </div>
        {!loading && items.length > 0 && visibleItems.length === 0 && <div className="empty">Không có chiến dịch ở trạng thái này trên trang hiện tại.</div>}
        {next && (
          <button className="button secondary" onClick={() => setCursor(next)}>
            Xem thêm
          </button>
        )}
      </section>
      <section className={`card campaign-detail-panel detail-panel-card ${selected ? 'is-open' : ''}`}>
        {selected && <DetailCloseButton onClick={() => setSelected(null)} />}
        <span className="eyebrow">{selected ? 'Hồ sơ chiến dịch' : 'Chiến dịch mới'}</span>
        <h2>{selected ? selected.name : 'Thiết lập chiến dịch mới'}</h2>
        {selected ? (
          <>
            <p className="campaign-objective">{selected.objective || 'Chưa có mô tả mục tiêu.'}</p>
            <dl className="fact-list">
              <div><dt>Trạng thái</dt><dd><span className="chip">{label(selected.status)}</span></dd></div>
              <div><dt>Khu vực</dt><dd>{selected.region_code || 'Nhiều khu vực'}</dd></div>
              <div><dt>Bắt đầu</dt><dd>{selected.starts_at ? timeLabel(selected.starts_at) : 'Chưa ấn định'}</dd></div>
              <div><dt>Kết thúc</dt><dd>{selected.ends_at ? timeLabel(selected.ends_at) : 'Chưa ấn định'}</dd></div>
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
          <CommandForm spec={create} onSuccess={done} />
        )}
      </section>
    </div>
  );
}
