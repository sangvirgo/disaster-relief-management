import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
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
      { name: 'region_code', label: 'Mã khu vực nếu có' },
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
    <div className="coordinator-layout">
      <section className="card">
        <h2>Chiến dịch cứu trợ</h2>
        <p>Trạng thái và phạm vi do dịch vụ Response xác nhận.</p>
        {loading && <p role="status">Đang tải chiến dịch…</p>}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && !items.length && (
          <div className="empty">Chưa có chiến dịch trong phạm vi được cấp quyền.</div>
        )}
        <div className="record-list">
          {items.map((item) => (
            <button
              className={`queue-row ${selected?.id === item.id ? 'selected' : ''}`}
              onClick={() => setSelected(item)}
              key={item.id}
            >
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.region_code || 'Nhiều khu vực'} · {timeLabel(item.created_at)}
                </small>
              </span>
              <span className="chip">{label(item.status)}</span>
            </button>
          ))}
        </div>
        {next && (
          <button className="button secondary" onClick={() => setCursor(next)}>
            Xem thêm
          </button>
        )}
      </section>
      <section className="card">
        <h2>{selected ? 'Chi tiết chiến dịch' : 'Tạo chiến dịch'}</h2>
        {selected ? (
          <>
            <p>
              <strong>{selected.name}</strong> · {label(selected.status)}
            </p>
            <p>{selected.objective || 'Chưa có mô tả mục tiêu.'}</p>
            <p>
              Khu vực: {selected.region_code || 'Nhiều khu vực'} · Phiên bản: {selected.version}
            </p>
            <p>
              Thời gian: {selected.starts_at ? timeLabel(selected.starts_at) : 'Chưa ấn định'} đến{' '}
              {selected.ends_at ? timeLabel(selected.ends_at) : 'Chưa ấn định'}
            </p>
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
            <button className="button secondary" onClick={() => setSelected(null)}>
              Quay lại danh sách
            </button>
          </>
        ) : (
          <CommandForm spec={create} onSuccess={done} />
        )}
      </section>
    </div>
  );
}
