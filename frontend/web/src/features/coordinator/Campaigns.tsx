import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useCursorNav, LIST_PAGE_SIZE } from '../../api/useCursorNav';
import { ListNav } from '../../components/ui/Pager';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { DetailSurface } from '../../components/DetailSurface';
import { Tabs } from '../../components/ui/Tabs';
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
  center?: { lat: number; lng: number } | null;
  radius_m?: number | null;
};
export function Campaigns({ canManage = false }: { canManage?: boolean }) {
  const [items, setItems] = useState<Campaign[]>([]);
  const [cursor, setCursor, prevPage, pageIndex] = useCursorNav<string>('');
  const [next, setNext] = useState('');
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [detailTab, setDetailTab] = useState('overview');
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
    setDetailTab('overview');
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
      { name: 'center_lat', label: 'Vĩ độ tâm vùng (nếu có)', type: 'number', min: -90, max: 90 },
      { name: 'center_lng', label: 'Kinh độ tâm vùng (nếu có)', type: 'number', min: -180, max: 180 },
      { name: 'radius_m', label: 'Bán kính tự động gắn (500–300.000 m)', type: 'number', min: 500, max: 300000, integer: true },
    ],
    build: (values) => {
      if (values.starts_at && values.ends_at && new Date(values.ends_at) <= new Date(values.starts_at))
        throw new Error('Thời điểm kết thúc phải sau thời điểm bắt đầu.');
      const hasLat = Boolean(values.center_lat?.trim());
      const hasLng = Boolean(values.center_lng?.trim());
      if (hasLat !== hasLng) throw new Error('Hãy nhập cả vĩ độ và kinh độ của tâm vùng.');
      const radius = values.radius_m?.trim() ? Number(values.radius_m) : null;
      if ((hasLat && (!radius || !Number.isInteger(radius) || radius < 500 || radius > 300000)) || (!hasLat && radius !== null))
        throw new Error('Tâm và bán kính phải cùng được nhập; bán kính từ 500 đến 300.000 mét.');
      return {
        name: values.name.trim().normalize('NFC'),
        ...(values.objective?.trim() ? { objective: values.objective.trim() } : {}),
        ...(values.starts_at ? { starts_at: new Date(values.starts_at).toISOString() } : {}),
        ...(values.ends_at ? { ends_at: new Date(values.ends_at).toISOString() } : {}),
        ...(hasLat ? { center: { lat: Number(values.center_lat), lng: Number(values.center_lng) }, radius_m: radius } : {}),
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
  const editSpatialAndDetails = id && version ? <CommandForm key={`${id}-edit-${version}`} spec={{
    title: 'Sửa thông tin chiến dịch', service: 'response', method: 'PATCH', path: `/campaigns/${id}`, version,
    fields: [
      { name: 'name', label: 'Tên chiến dịch', required: true, initialValue: selected!.name },
      { name: 'objective', label: 'Mục tiêu', type: 'textarea', initialValue: selected!.objective ?? '' },
      { name: 'center_lat', label: 'Vĩ độ tâm vùng', type: 'number', min: -90, max: 90, initialValue: selected!.center ? String(selected!.center.lat) : '' },
      { name: 'center_lng', label: 'Kinh độ tâm vùng', type: 'number', min: -180, max: 180, initialValue: selected!.center ? String(selected!.center.lng) : '' },
      { name: 'radius_m', label: 'Bán kính tự động gắn (500–300.000 m)', type: 'number', min: 500, max: 300000, integer: true, initialValue: selected!.radius_m ? String(selected!.radius_m) : '' },
    ],
    build: (values) => {
      const hasLat = Boolean(values.center_lat?.trim()); const hasLng = Boolean(values.center_lng?.trim());
      const radius = values.radius_m?.trim() ? Number(values.radius_m) : null;
      if (hasLat !== hasLng || (hasLat && (!radius || !Number.isInteger(radius) || radius < 500 || radius > 300000)) || (!hasLat && radius !== null))
        throw new Error('Tâm và bán kính phải cùng được nhập; bán kính từ 500 đến 300.000 mét.');
      return { name: values.name.trim().normalize('NFC'), objective: values.objective.trim() || null,
        center: hasLat ? { lat: Number(values.center_lat), lng: Number(values.center_lng) } : null, radius_m: radius };
    },
  }} onSuccess={() => done()} onStale={() => done()} /> : null;
  return (
    <div className="campaign-layout campaign-table-layout">
      <section className="card campaign-list-panel">
        {createdName && <div className="campaign-success-toast"><SuccessBanner title="Đã tạo chiến dịch thành công" description={`Chiến dịch “${createdName}” đã được lưu. Bạn có thể chọn trong danh sách để kích hoạt.`} /></div>}
        <div className="section-header">
          <div>
            <span className="eyebrow">Vận hành cứu trợ</span>
            <h2>Danh sách chiến dịch</h2>
          </div>
          <div className="list-header-actions">
            <span className="chip">Đã tải {items.length} chiến dịch</span>
            <button type="button" className="button secondary" disabled={loading} onClick={done}>Cập nhật</button>
            {canManage && <button type="button" className="button primary" onClick={() => setShowCreate(true)}>Tạo chiến dịch</button>}
          </div>
        </div>
        <p>Chọn chiến dịch để xem mục tiêu, thời gian và thao tác được cấp quyền.</p>
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
        {visibleItems.length > 0 && <div className="operations-table-scroll" role="region" aria-label="Bảng chiến dịch" tabIndex={0}>
          <table className="operations-record-table">
            <thead><tr><th scope="col">Chiến dịch</th><th scope="col">Mục tiêu</th><th scope="col">Ngày tạo</th><th scope="col">Trạng thái</th></tr></thead>
            <tbody>{visibleItems.map((item) => <tr key={item.id}>
              <th scope="row"><button type="button" className="table-row-link" onClick={() => { setConflictNotice(''); setDetailTab('overview'); setSelected(item); }}>{item.name}</button></th>
              <td>{item.objective || 'Chưa ghi mục tiêu'}</td>
              <td>{timeLabel(item.created_at)}</td>
              <td><StatusBadge status={item.status} /></td>
            </tr>)}</tbody>
          </table>
        </div>}
        {!loading && items.length > 0 && visibleItems.length === 0 && (
          <div className="empty">Không có chiến dịch ở trạng thái này trên trang hiện tại.</div>
        )}
        <ListNav page={pageIndex} hasNext={Boolean(next)} loading={loading} onPrev={prevPage} onNext={() => next && setCursor(next)} count={items.length} noun="chiến dịch" />
      </section>
      {selected && <DetailSurface key={selected.id} modal open onClose={() => setSelected(null)} label={`Chi tiết chiến dịch ${selected.name}`} heading={selected.name} className="campaign-management-dialog">
        <Tabs items={[{ id: 'overview', label: 'Thông tin' }, ...(canManage && ['DRAFT', 'ACTIVE', 'PAUSED'].includes(selected.status) ? [{ id: 'actions', label: 'Quản lý' }] : [])]} value={detailTab} onChange={setDetailTab} ariaLabel="Nội dung chiến dịch" idBase="campaign-detail" />
        <div role="tabpanel" id="campaign-detail-tabpanel" aria-labelledby={`campaign-detail-tab-${detailTab}`}>
          <div hidden={detailTab !== 'overview'}>
            <p className="campaign-objective">{selected.objective || 'Chưa ghi mục tiêu cho chiến dịch.'}</p>
            <dl className="fact-list">
              <div>
                <dt>Trạng thái</dt>
                <dd>
                  <StatusBadge status={selected.status} />
                </dd>
              </div>
              <div>
                <dt>Bắt đầu</dt>
                <dd>{selected.starts_at ? timeLabel(selected.starts_at) : 'Chưa đặt thời gian'}</dd>
              </div>
              <div>
                <dt>Kết thúc</dt>
                <dd>{selected.ends_at ? timeLabel(selected.ends_at) : 'Chưa đặt thời gian'}</dd>
              </div>
              <div><dt>Tâm vùng</dt><dd>{selected.center ? `${selected.center.lat}, ${selected.center.lng}` : 'Chưa cấu hình vùng tự động gắn'}</dd></div>
              <div><dt>Bán kính tự động gắn</dt><dd>{selected.radius_m ? `${selected.radius_m.toLocaleString('vi-VN')} m` : 'Chưa cấu hình'}</dd></div>
            </dl>
          </div>
          <div hidden={detailTab !== 'actions'}>
            <p>Chọn thao tác phù hợp với trạng thái hiện tại của chiến dịch.</p>
            <div className="action-grid">
              {canManage && editSpatialAndDetails}
              {canManage && selected.status === 'DRAFT' && action('Kích hoạt chiến dịch', 'activate')}
              {canManage && selected.status === 'ACTIVE' && (
                <>
                  {action('Tạm dừng chiến dịch', 'pause', true)}
                  {action('Kết thúc chiến dịch', 'close', true)}
                </>
              )}
              {canManage && selected.status === 'PAUSED' && (
                <>
                  {action('Tiếp tục chiến dịch', 'resume')}
                  {action('Kết thúc chiến dịch', 'close', true)}
                </>
              )}
              {!canManage && <p className="muted">Bạn có quyền xem chiến dịch nhưng không có quyền quản lý chiến dịch.</p>}
              {canManage && !['DRAFT', 'ACTIVE', 'PAUSED'].includes(selected.status) && <p className="muted">Chiến dịch đã kết thúc, không còn thao tác quản lý.</p>}
            </div>
          </div>
        </div>
      </DetailSurface>}
      {canManage && <DetailSurface modal open={showCreate} onClose={() => setShowCreate(false)} label="Tạo chiến dịch" heading="Tạo chiến dịch" className="campaign-management-dialog">
        {showCreate && <CommandForm key={revision} spec={create} onSuccess={(result) => { setCreatedName((result as Campaign | undefined)?.name || 'mới'); setShowCreate(false); done(); }} />}
      </DetailSurface>}
    </div>
  );
}
